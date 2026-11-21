#!/usr/bin/env bash
# Production Chaperon triage reprise runner (insert-only, idempotent, source='manual').
# Derives a one-shot Job from Deployment/radar-api in namespace radar-immobilier.
# Invoked only from .github/workflows/chaperon-reprise-prod.yml (environment: production).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
KUBECTL="${KUBECTL:-kubectl}"
NAMESPACE="${NAMESPACE:-radar-immobilier}"
MODE="${REPRISE_MODE:-dry-run}"
CONFIRM="${REPRISE_CONFIRM:-}"
OWNER_ACCOUNTS="${REPRISE_OWNER_ACCOUNTS:-}"
WORKSPACE_SLUG="agence-chaperon-immobilier"
OWNER_EMAIL_DOMAIN="chaperonimmobilier.com"
KEY_NAMESPACE="6c1f3a52-8f0e-5b7d-9a41-2e6d0c9b7f13"
TEMPLATE_PATH="${TEMPLATE_PATH:-$ROOT/deploy/ci/chaperon-reprise-prod.tmpl.yaml}"
SEALED_CSV_PATH="${SEALED_CSV_PATH:-$ROOT/docs/spec/reports/reference-c/reference-c.csv.sealed}"
WAIT_SECONDS="${REPRISE_WAIT_SECONDS:-660}"
POLL_SECONDS="${REPRISE_POLL_SECONDS:-5}"

[[ "$NAMESPACE" == "radar-immobilier" ]] \
  || { echo "::error::Refusing non-prod namespace '${NAMESPACE}'" >&2; exit 1; }
case "$MODE" in
  dry-run|apply) ;;
  *) echo "::error::REPRISE_MODE must be dry-run or apply (got '${MODE}')" >&2; exit 1 ;;
esac
if [[ "$MODE" == "apply" && "$CONFIRM" != "$WORKSPACE_SLUG" ]]; then
  echo "::error::REPRISE_MODE=apply requires REPRISE_CONFIRM=${WORKSPACE_SLUG}" >&2
  exit 1
fi
[[ -f "$TEMPLATE_PATH" ]] && grep -Fq 'dist/scripts/chaperon-reprise-apply.js' "$TEMPLATE_PATH" \
  || { echo "::error::Missing or invalid template '${TEMPLATE_PATH}'" >&2; exit 1; }
if [[ -z "${CHAPERON_REPRISE_CSV_PATH:-}" ]]; then
  [[ -f "$SEALED_CSV_PATH" ]] \
    || { echo "::error::Missing sealed reference file '${SEALED_CSV_PATH}'" >&2; exit 1; }
  [[ -n "${REFERENCE_C_KEY:-}" ]] \
    || { echo "::error title=Missing secret::REFERENCE_C_KEY is empty or not visible." >&2; exit 1; }
fi

# Pre-flight: verify cluster identity and minimal prod permissions.
DEFAULT_HOST='hlhedx.c1.bhs5.k8s.ovh.net'
expected="${EXPECTED_KUBE_APISERVER_HOST_PROD:-${EXPECTED_KUBE_APISERVER_HOST:-$DEFAULT_HOST}}"
server="$("$KUBECTL" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
host="${server#*://}"; host="${host%%/*}"; host="${host%%:*}"
if [[ "$host" != "$expected" ]]; then
  echo "::error title=Wrong cluster — reprise refused::apiserver host '${host:-<none>}' != '${expected}'." >&2
  exit 1
fi

can_create="$("$KUBECTL" auth can-i create jobs.batch -n "$NAMESPACE" 2>/dev/null || true)"
if [[ "$can_create" != "yes" ]]; then
  echo "::error title=Cannot create Jobs::credential cannot create batch/jobs in ${NAMESPACE} (answer: '${can_create:-<none>}')." >&2
  exit 1
fi

"$KUBECTL" -n "$NAMESPACE" get deployment radar-api -o name >/dev/null

JOB_NAME="${JOB_NAME:-radar-chaperon-reprise-prod-$(date -u +%Y%m%d%H%M%S)}"
WORK="$(mktemp -d "${RUNNER_TEMP:-/tmp}/chaperon-reprise-prod.XXXXXX")"
chmod 700 "$WORK"
job_created=0
cleanup() {
  if [[ "$job_created" -eq 1 ]]; then
    "$KUBECTL" -n "$NAMESPACE" delete job "$JOB_NAME" --ignore-not-found=true --wait=false >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# Unseal reference-c.csv into a mode-700 temp dir and build the compact plan (never prints sheet text).
if [[ -n "${CHAPERON_REPRISE_CSV_PATH:-}" ]]; then
  csv_path="$CHAPERON_REPRISE_CSV_PATH"
  skip_sha_check=1
else
  refc_dir="$WORK/refc"
  mkdir -m 700 "$refc_dir"
  node "$ROOT/scripts/reference-seal.mjs" unseal "$SEALED_CSV_PATH" --out "$refc_dir" >/dev/null
  csv_path="$refc_dir/reference-c.csv"
  skip_sha_check=0
fi

plan_b64_file="$WORK/plan.b64"
ROOT_DIR="$ROOT" CSV_PATH="$csv_path" SKIP_SHA="$skip_sha_check" \
  WORKSPACE_SLUG="$WORKSPACE_SLUG" OWNER_EMAIL_DOMAIN="$OWNER_EMAIL_DOMAIN" \
  KEY_NAMESPACE="$KEY_NAMESPACE" OWNER_ACCOUNTS="$OWNER_ACCOUNTS" \
  node --input-type=module - > "$plan_b64_file" <<'EOF'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const mod = await import(pathToFileURL(path.join(process.env.ROOT_DIR, 'scripts/chaperon-reprise-plan.mjs')).href);
const bytes = readFileSync(process.env.CSV_PATH);
const sha = createHash('sha256').update(bytes).digest('hex');
if (process.env.SKIP_SHA !== '1' && sha !== mod.SOURCE.referenceCsvSha256) {
  throw new Error(`reference-c.csv sha256 ${sha} differs from sealed reference`);
}
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const owners = (process.env.OWNER_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (owners.some((id) => !uuidRe.test(id)) || new Set(owners).size !== owners.length) {
  throw new Error('invalid REPRISE_OWNER_ACCOUNTS (must be unique UUIDs)');
}
const built = mod.buildPlan(bytes.toString('utf8'));
const plan = {
  workspaceSlug: process.env.WORKSPACE_SLUG,
  ownerEmailDomain: process.env.OWNER_EMAIL_DOMAIN,
  ownerAccountIds: owners,
  profile: mod.PROFILE,
  keyNamespace: process.env.KEY_NAMESPACE,
  manifestSha: sha,
  mapping: mod.MAPPING_VERSION,
  targets: built.targets,
};
process.stdout.write(Buffer.from(JSON.stringify(plan), 'utf8').toString('base64'));
EOF

deploy_json="$WORK/deploy.json"
manifest="$WORK/job.json"
logs_file="$WORK/job.log"

"$KUBECTL" -n "$NAMESPACE" get deployment radar-api -o json > "$deploy_json"

if [[ "$MODE" == "apply" ]]; then
  cmd_json="$(jq -cn --arg ws "$WORKSPACE_SLUG" '["node","dist/scripts/chaperon-reprise-apply.js","--apply","--confirm",$ws,"--allow-prod"]')"
else
  cmd_json='["node","dist/scripts/chaperon-reprise-apply.js","--dry-run","--allow-prod"]'
fi

jq \
  --arg jobName "$JOB_NAME" \
  --arg namespace "$NAMESPACE" \
  --argjson command "$cmd_json" \
  --rawfile planB64 "$plan_b64_file" \
  '
  (.spec.template.spec.containers | map(select(.name == "radar-api")) | .[0] // .spec.template.spec.containers[0]) as $c |
  {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: $jobName,
      namespace: $namespace,
      labels: {
        "app.kubernetes.io/name": "radar-immobilier",
        "app.kubernetes.io/part-of": "sentropic",
        "app.kubernetes.io/component": "api",
        "app.kubernetes.io/instance": "radar-chaperon-reprise"
      }
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 600,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "radar-immobilier",
            "app.kubernetes.io/part-of": "sentropic",
            "app.kubernetes.io/component": "api",
            "app.kubernetes.io/instance": "radar-chaperon-reprise"
          }
        },
        spec: {
          restartPolicy: "Never",
          serviceAccountName: (.spec.template.spec.serviceAccountName // "radar-app"),
          automountServiceAccountToken: false,
          securityContext: (.spec.template.spec.securityContext // {
            runAsNonRoot: true, runAsUser: 1001, runAsGroup: 1001, fsGroup: 1001,
            seccompProfile: { type: "RuntimeDefault" }
          }),
          containers: [
            {
              name: "chaperon-reprise",
              image: $c.image,
              imagePullPolicy: ($c.imagePullPolicy // "IfNotPresent"),
              workingDir: "/workspace/api",
              securityContext: ($c.securityContext // {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: false,
                capabilities: { drop: ["ALL"] }
              }),
              command: $command,
              envFrom: ($c.envFrom // []),
              env: (($c.env // []) | map(select(.name != "CHAPERON_REPRISE_PLAN_B64"))) + [
                { name: "CHAPERON_REPRISE_PLAN_B64", value: ($planB64 | gsub("\n"; "")) }
              ]
            }
          ]
        }
      }
    }
  }
  ' "$deploy_json" > "$manifest"

"$KUBECTL" -n "$NAMESPACE" create -f "$manifest" >/dev/null
job_created=1
echo "chaperon-reprise-prod ${MODE} started: ${NAMESPACE}/${JOB_NAME}"

deadline=$(( $(date +%s) + WAIT_SECONDS ))
job_failed=0
while :; do
  state="$("$KUBECTL" -n "$NAMESPACE" get job "$JOB_NAME" -o json)"
  if jq -e 'any(.status.conditions[]?; .type == "Complete" and .status == "True")' <<< "$state" >/dev/null; then
    break
  fi
  if jq -e 'any(.status.conditions[]?; .type == "Failed" and .status == "True")' <<< "$state" >/dev/null; then
    job_failed=1
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "::error title=Reprise timeout::Job ${NAMESPACE}/${JOB_NAME} did not finish within ${WAIT_SECONDS}s." >&2
    exit 1
  fi
  sleep "$POLL_SECONDS"
done

"$KUBECTL" -n "$NAMESPACE" logs "job/$JOB_NAME" > "$logs_file"
cat "$logs_file"

report_line="$(grep '"kind":"chaperon-reprise"' "$logs_file" | tail -n 1 || true)"
if [[ -z "$report_line" ]]; then
  echo "::error title=Missing reprise report::No chaperon-reprise JSON line found in job/${JOB_NAME} logs." >&2
  exit 1
fi

summary_md="$(jq -r --arg job "${NAMESPACE}/${JOB_NAME}" '
  "### Prod Chaperon triage reprise (\(.mode))\n\n"
  + "- **Job** : `\($job)`\n"
  + "- **Workspace** : `\(.dryRun.workspace.slug)` (`\(.dryRun.workspace.id)`)\n"
  + "- **Mapping** : `\(.mapping)` (manifest `\(.manifestSha[0:12])`)\n"
  + "- **Writable** : `\(.dryRun.writable)`\n\n"
  + "| Indicateur | Valeur |\n"
  + "| --- | ---: |\n"
  + "| Cibles plan | \(.dryRun.match.targets) |\n"
  + "| Cibles résolues | \(.dryRun.match.resolvedTargets) |\n"
  + "| Exact / Par clé | \(.dryRun.match.exact) / \(.dryRun.match.byKey) |\n"
  + "| Ambigus / Introuvables / Conflits | \(.dryRun.match.ambiguous | length) / \(.dryRun.match.notFound | length) / \(.dryRun.match.resolvedConflicts | length) |\n\n"
  + "#### Comptes\n\n"
  + "| Compte (UUID) | Plan insert | Plan noop | Plan skip | Appliqué insert | Appliqué noop | Appliqué skip | Readback écarts |\n"
  + "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n"
  + (
      .dryRun.accounts as $da |
      (.apply.accounts // []) as $aa |
      $da | map(
        . as $d |
        ($aa | map(select(.accountId == $d.accountId)) | .[0]) as $a |
        "| `\($d.accountId)` | \($d.plan.insert) | \($d.plan.noop) | \($d.plan.skipExisting) | \($a.applied.inserted // "-") | \($a.applied.noop // "-") | \($a.applied.skipped // "-") | \(if $a then ($a.readback.mismatchedRows | length) else "-" end) |"
      ) | join("\n")
    ) + "\n"
' <<< "$report_line")"

printf '\n%s\n' "$summary_md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' "$summary_md" >> "$GITHUB_STEP_SUMMARY"
fi

mismatched_count="$(jq -r '[(.apply.accounts // [])[] | .readback.mismatchedRows | length] | add // 0' <<< "$report_line")"
if [[ "$job_failed" -ne 0 || "$mismatched_count" -ne 0 ]]; then
  echo "::error title=Chaperon reprise failed::Job failed=${job_failed}, readbackMismatches=${mismatched_count}." >&2
  exit 1
fi
