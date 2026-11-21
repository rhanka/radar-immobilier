#!/usr/bin/env bash
# Production 30-day two-step signal reannotation runner (derived from CronJob/radar-refresh-pv).
# Invoked only from .github/workflows/reannotate-signals-prod.yml (environment: production).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
KUBECTL="${KUBECTL:-kubectl}"
NAMESPACE="${NAMESPACE:-radar-immobilier}"
MODE="${REANNOTATION_MODE:-dry-run}"
SINCE_DAYS="${REANNOTATION_SINCE_DAYS:-30}"
TEMPLATE_PATH="${TEMPLATE_PATH:-$ROOT/deploy/ci/reannotate-signals-prod.tmpl.yaml}"
WAIT_SECONDS="${REANNOTATION_WAIT_SECONDS:-19800}"
POLL_SECONDS="${REANNOTATION_POLL_SECONDS:-15}"

[[ "$NAMESPACE" == "radar-immobilier" ]] \
  || { echo "::error::Refusing non-prod namespace '${NAMESPACE}'" >&2; exit 1; }
case "$MODE" in
  dry-run|apply) ;;
  *) echo "::error::REANNOTATION_MODE must be dry-run or apply (got '${MODE}')" >&2; exit 1 ;;
esac
[[ "$SINCE_DAYS" =~ ^[0-9]+$ ]] && (( SINCE_DAYS >= 1 && SINCE_DAYS <= 365 )) \
  || { echo "::error::REANNOTATION_SINCE_DAYS must be an integer 1..365 (got '${SINCE_DAYS}')" >&2; exit 1; }
[[ -f "$TEMPLATE_PATH" ]] && grep -Fq 'dist/scripts/reannotate-signals.js' "$TEMPLATE_PATH" \
  || { echo "::error::Missing or invalid template '${TEMPLATE_PATH}'" >&2; exit 1; }

PIPELINE_RUN_ID="${PIPELINE_RUN_ID:-prod-reannotate-${SINCE_DAYS}d-${GITHUB_RUN_ID:-$(date -u +%Y%m%d%H%M%S)}-${GITHUB_RUN_ATTEMPT:-1}}"
[[ "$PIPELINE_RUN_ID" =~ ^[A-Za-z0-9._:-]{1,200}$ ]] \
  || { echo "::error::Invalid PIPELINE_RUN_ID '${PIPELINE_RUN_ID}'" >&2; exit 1; }

# Pre-flight: verify cluster identity and minimal prod permissions.
DEFAULT_HOST='hlhedx.c1.bhs5.k8s.ovh.net'
expected="${EXPECTED_KUBE_APISERVER_HOST_PROD:-${EXPECTED_KUBE_APISERVER_HOST:-$DEFAULT_HOST}}"
server="$("$KUBECTL" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
host="${server#*://}"; host="${host%%/*}"; host="${host%%:*}"
if [[ "$host" != "$expected" ]]; then
  echo "::error title=Wrong cluster — reannotation refused::apiserver host '${host:-<none>}' != '${expected}'." >&2
  exit 1
fi

can_create="$("$KUBECTL" auth can-i create jobs.batch -n "$NAMESPACE" 2>/dev/null || true)"
if [[ "$can_create" != "yes" ]]; then
  echo "::error title=Cannot create Jobs::credential cannot create batch/jobs in ${NAMESPACE} (answer: '${can_create:-<none>}')." >&2
  exit 1
fi

"$KUBECTL" -n "$NAMESPACE" get cronjob radar-refresh-pv -o name >/dev/null

JOB_NAME="${JOB_NAME:-radar-reannotate-prod-$(date -u +%Y%m%d%H%M%S)}"
WORK="$(mktemp -d "${RUNNER_TEMP:-/tmp}/reannotate-prod.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

base_json="$WORK/base-job.json"
manifest="$WORK/job.json"
logs_file="$WORK/job.log"

"$KUBECTL" -n "$NAMESPACE" create job "$JOB_NAME" --from=cronjob/radar-refresh-pv --dry-run=client -o json > "$base_json"

# Fail closed unless CronJob/radar-refresh-pv already carries two-step B+C + Astra 6.2 low + Muse fallback.
jq -e '
  (.spec.template.spec.containers | map(select(.name == "refresh-pv")) | .[0].env // []) as $env |
  def val($k): ($env | map(select(.name == $k)) | .[0].value // "");
  val("REFRESH_CLASSIFY_MODE") == "two-step"
  and val("REFRESH_SINGLE_PASS") == "0"
  and val("REFRESH_CLASSIFY_PROVIDER") == "openai"
  and val("REFRESH_CLASSIFY_MODEL") == "gpt-6.2-astra"
  and val("REFRESH_CLASSIFY_REASONING_EFFORT") == "low"
  and val("REFRESH_CLASSIFY_FALLBACK_PROVIDER") == "muse"
  and val("REFRESH_CLASSIFY_FALLBACK_MODEL") == "muse-wonder-1.0"
  and val("REFRESH_CLASSIFY_FALLBACK_REASONING_EFFORT") == "low"
' "$base_json" >/dev/null || {
  echo "::error title=CronJob contract mismatch::CronJob/radar-refresh-pv in ${NAMESPACE} must run REFRESH_CLASSIFY_MODE=two-step, REFRESH_SINGLE_PASS=0, openai/gpt-6.2-astra/low primary, and muse/muse-wonder-1.0/low fallback before prod reannotation." >&2
  exit 1
}

jq \
  --arg mode "--${MODE}" \
  --arg sinceDays "$SINCE_DAYS" \
  --arg runId "$PIPELINE_RUN_ID" \
  '
  .spec.ttlSecondsAfterFinished = 86400
  | .spec.template.metadata.labels["app.kubernetes.io/instance"] = "radar-reannotate-signals"
  | .spec.template.spec.containers |= map(
      if .name == "refresh-pv" then
        .command = ["/usr/bin/flock", "-n", "/keyring/runtime/.refresh.lock", "node",
          "dist/scripts/reannotate-signals.js", $mode]
        | del(.args)
        | .env = ((.env // []) | map(select(.name != "REANNOTATION_SINCE_DAYS" and .name != "PIPELINE_RUN_ID")))
          + [
              { name: "REANNOTATION_SINCE_DAYS", value: $sinceDays },
              { name: "PIPELINE_RUN_ID", value: $runId }
            ]
      else . end
    )
  ' "$base_json" > "$manifest"

"$KUBECTL" -n "$NAMESPACE" create -f "$manifest" >/dev/null
echo "reannotate-prod ${MODE} started: ${NAMESPACE}/${JOB_NAME} (PIPELINE_RUN_ID=${PIPELINE_RUN_ID}, sinceDays=${SINCE_DAYS})"

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
    echo "::error title=Reannotation timeout::Job ${NAMESPACE}/${JOB_NAME} did not finish within ${WAIT_SECONDS}s." >&2
    exit 1
  fi
  sleep "$POLL_SECONDS"
done

"$KUBECTL" -n "$NAMESPACE" logs "job/$JOB_NAME" > "$logs_file"
cat "$logs_file"

report_line="$(grep '"kind":"signal-reannotation"' "$logs_file" | tail -n 1 || true)"
if [[ -z "$report_line" ]]; then
  echo "::error title=Missing reannotation report::No signal-reannotation JSON line found in job/${JOB_NAME} logs." >&2
  exit 1
fi

summary_md="$(jq -r --arg job "${NAMESPACE}/${JOB_NAME}" '
  "### Prod signal reannotation (\(.mode))\n\n"
  + "- **Job** : `\($job)`\n"
  + "- **PIPELINE_RUN_ID** : `\(.pipelineRunId)`\n"
  + "- **Prompt** : `\(.promptId)` (`\(.promptSha256)`)\n"
  + "- **Fenêtre** : `\(.sinceDays)` jours (depuis `\(.since)`)\n\n"
  + "| Indicateur | Valeur |\n"
  + "| --- | ---: |\n"
  + "| Candidats | \(.candidates) |\n"
  + "| Traités | \(.processed // (.classified + .skippedManual + .skippedUnchanged + (.failures | length))) |\n"
  + "| Classés | \(.classified) |\n"
  + "| Écrits | \(.written) |\n"
  + "| Refusés (priorité humaine) | \(.refused // .skippedManual) |\n"
  + "| Inchangés | \(.skippedUnchanged) |\n"
  + "| En échec | \(.failed // (.failures | length)) |\n"
  + "| Pertinent / À surveiller / Écarté | \(.classes.pertinent) / \(.classes.a_surveiller) / \(.classes.ecarte) |\n\n"
  + "#### Signaux par ville\n\n"
  + (if ((.candidatesByCity // {}) | length) == 0 then
       "_Aucun signal dans la fenêtre._\n"
     else
       "| Ville | Signaux |\n| --- | ---: |\n"
       + ((.candidatesByCity | to_entries | sort_by(.key) | map("| `\(.key)` | \(.value) |") | join("\n")) + "\n")
     end)
' <<< "$report_line")"

printf '\n%s\n' "$summary_md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' "$summary_md" >> "$GITHUB_STEP_SUMMARY"
fi

failed_count="$(jq -r '.failed // (.failures | length)' <<< "$report_line")"
if [[ "$job_failed" -ne 0 || "$failed_count" -ne 0 ]]; then
  echo "::error title=Reannotation failed::Job failed=${job_failed}, failedSignals=${failed_count}." >&2
  exit 1
fi
