#!/usr/bin/env bash
# Read-only production drift check (8 non-Deployment objects rendered from main).
# Never modifies the cluster and never reads Secret values.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
NAMESPACE="${NAMESPACE:-radar-immobilier}"
[[ "$NAMESPACE" == "radar-immobilier" ]] || { echo "::error::Refusing non-prod namespace '$NAMESPACE'"; exit 1; }

tmp="$(mktemp -d "${RUNNER_TEMP:-/tmp}/prod-drift.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
rendered="$tmp/rendered"; live="$tmp/live"; mkdir -p "$rendered" "$live"

DEFAULT_HOST='hlhedx.c1.bhs5.k8s.ovh.net'
expected="${EXPECTED_KUBE_APISERVER_HOST_PROD:-${EXPECTED_KUBE_APISERVER_HOST:-$DEFAULT_HOST}}"
server="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
host="${server#*://}"; host="${host%%/*}"; host="${host%%:*}"
if [ "$host" != "$expected" ]; then
  echo "::error title=Wrong cluster — prod-drift-check refused::apiserver host '${host:-<none>}' != '${expected}'."
  exit 1
fi

kubectl -n "$NAMESPACE" get deploy radar-api -o json > "$tmp/served-deploy.json"
served_api="$(jq -er '.spec.template.spec.containers[0].image // empty' "$tmp/served-deploy.json")"
[[ "$served_api" =~ ^ghcr\.io/rhanka/radar-api@sha256:[0-9a-f]{64}$ ]] \
  || { echo "::error title=Unpinned served API::live deploy/radar-api image '${served_api}' is not @sha256"; exit 1; }
echo "pre-flight OK — host=${expected} namespace=${NAMESPACE} served=${served_api}"

cp "$ROOT/deploy/ci/backup/cronjob-backup-daily.yaml" "$rendered/radar-backup-daily.yaml"
cp "$ROOT/deploy/ci/backup/cronjob-backup-freshness.yaml" "$rendered/radar-backup-freshness.yaml"
cp "$ROOT/deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml" "$rendered/radar-db-backup-prod.yaml"

make --no-print-directory -f "$ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" render-prod \
  IMAGE_REF="$served_api" RENDER_OUT="$tmp/refresh-prod.yaml" ENV=prod >/dev/null
bash "$ROOT/deploy/ci/kfilter.sh" "$tmp/refresh-prod.yaml" CronJob radar-refresh-pv > "$rendered/radar-refresh-pv.yaml"
bash "$ROOT/deploy/ci/kfilter.sh" "$tmp/refresh-prod.yaml" CronJob radar-refresh-pending-watchdog > "$rendered/radar-refresh-pending-watchdog.yaml"
bash "$ROOT/deploy/ci/kfilter.sh" "$tmp/refresh-prod.yaml" PersistentVolumeClaim radar-refresh-keyring > "$rendered/radar-refresh-keyring.yaml"

kubectl -n "$NAMESPACE" create configmap radar-backup-daily-script \
  --from-file=backup-daily.cjs="$ROOT/deploy/ci/backup/backup-daily.cjs" --dry-run=client -o yaml \
  | kubectl label --local -f - app.kubernetes.io/name=radar-immobilier app.kubernetes.io/part-of=sentropic \
      app.kubernetes.io/component=db-backup -o yaml > "$rendered/radar-backup-daily-script.yaml"

kubectl kustomize "$ROOT/deploy/k8s/immo-mcp" > "$tmp/immo-mcp-all.yaml"
bash "$ROOT/deploy/ci/kfilter.sh" "$tmp/immo-mcp-all.yaml" ConfigMap immo-mcp-config > "$rendered/immo-mcp-config.yaml"

TARGETS=(
  "CronJob|radar-backup-daily"
  "CronJob|radar-backup-freshness"
  "CronJob|radar-db-backup-prod"
  "CronJob|radar-refresh-pv"
  "CronJob|radar-refresh-pending-watchdog"
  "ConfigMap|radar-backup-daily-script"
  "ConfigMap|immo-mcp-config"
  "PersistentVolumeClaim|radar-refresh-keyring"
)

: > "$tmp/findings.txt"
clean_count=0
for spec in "${TARGETS[@]}"; do
  kind="${spec%%|*}"; name="${spec##*|}"
  file="$rendered/${name}.yaml"
  node "$SCRIPT_DIR/check-prod-drift-summary.mjs" validate-render "$kind" "$name" "$file" >/dev/null
  diff_out="$tmp/${name}.diff"; diff_err="$tmp/${name}.err"; rc=0
  kubectl -n "$NAMESPACE" diff -f "$file" > "$diff_out" 2> "$diff_err" || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "OK     ${kind}/${name}"
    clean_count=$((clean_count + 1))
  elif [ "$rc" -eq 1 ]; then
    node "$SCRIPT_DIR/check-prod-drift-summary.mjs" summarize-diff "${kind}/${name}" "$diff_out" >> "$tmp/findings.txt"
  else
    err_msg="$(tr '\n' ' ' < "$diff_err")"
    echo "DRIFT|${kind}/${name}|kubectl-diff-error|exit=${rc} ${err_msg}" >> "$tmp/findings.txt"
  fi
done

have_all=1
for cj in radar-backup-daily radar-backup-freshness radar-db-backup-prod radar-refresh-pv radar-refresh-pending-watchdog; do
  if ! kubectl -n "$NAMESPACE" get cronjob "$cj" -o json > "$live/${cj}.json" 2> "$tmp/${cj}.geterr"; then
    echo "DRIFT|CronJob/${cj}|live-get-error|$(tr '\n' ' ' < "$tmp/${cj}.geterr")" >> "$tmp/findings.txt"
    have_all=0
  fi
done
if [ "$have_all" -eq 1 ]; then
  if ! img_out="$(node "$SCRIPT_DIR/check-prod-drift-summary.mjs" verify-images "$tmp/served-deploy.json" "${EXPECTED_API_IMAGE:-}" "$live" "$rendered" 2>&1)"; then
    printf '%s\n' "$img_out" | grep '^INFO ' || true
    printf '%s\n' "$img_out" | grep -v '^INFO ' | sed '/^DRIFT|/!s/^/DRIFT|images|check|/' >> "$tmp/findings.txt" || true
  else
    printf '%s\n' "$img_out"
  fi
fi

can_secrets="$(kubectl -n "$NAMESPACE" auth can-i get secrets 2>/dev/null || true)"
if [ "$can_secrets" = "yes" ]; then
  for sec in radar-backup-writer radar-backup-reader radar-backup-purger radar-db-ro-prod radar-pra-admin-prod immo-mcp-signal-writer; do
    if ! kubectl -n "$NAMESPACE" get secret "$sec" -o name >/dev/null 2>&1; then
      echo "DRIFT|Secret/${sec}|metadata.name|absent from namespace ${NAMESPACE} (name check only)" >> "$tmp/findings.txt"
    fi
  done
  echo "INFO Secret existence check (names only, 0 values read): checked 6 expected Secrets"
else
  echo "INFO secrets:get=${can_secrets:-no} — Secret existence check skipped (Secrets excluded, 0 values read)"
fi

if [ -s "$tmp/findings.txt" ]; then
  echo "::error title=Production drift detected::${clean_count}/${#TARGETS[@]} clean; drift/error summary below:"
  while IFS='|' read -r _tag obj field detail; do
    echo "DRIFT (${obj}, ${field}): ${detail}" >&2
    echo "::error title=Drift (${obj} — ${field})::${detail}"
  done < "$tmp/findings.txt"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Prod drift check FAILED"
      echo ""
      echo "| Object | Field | Detail |"
      echo "| --- | --- | --- |"
      while IFS='|' read -r _tag obj field detail; do
        echo "| \`${obj}\` | \`${field}\` | ${detail} |"
      done < "$tmp/findings.txt"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 1
fi

echo "PASS prod-drift-check: ${clean_count}/${#TARGETS[@]} non-Deployment objects match main; images verified"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "### Prod drift check PASSED (${clean_count}/${#TARGETS[@]} non-Deployment objects clean, served=${served_api})" >> "$GITHUB_STEP_SUMMARY"
fi
