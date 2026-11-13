#!/usr/bin/env bash
# Reuse the suspended refresh's image, credentials, resource limits and shared writer lock.
set -euo pipefail
: "${KUBECONFIG:?Set an explicit dedicated preprod kubeconfig}"
if [[ "$(realpath "$KUBECONFIG")" == "$HOME/.kube/config" ]]; then
  echo 'The default kubeconfig is forbidden' >&2; exit 1
fi
mode="${REANNOTATION_MODE:-dry-run}"
case "$mode" in dry-run|apply) ;; *) echo 'Expected dry-run or apply' >&2; exit 1;; esac
namespace=radar-immobilier-preprod
fail() { echo "Reannotation refused: $*" >&2; exit 1; }
source tools/make/cutover-release.sh
source tools/make/cutover-cluster.sh
cutover_config
cluster_preflight
k=("${KUBECTL:-kubectl}" --kubeconfig "$KUBECONFIG" --request-timeout=30s -n "$namespace")
job="radar-reannotate-$(date -u +%Y%m%d%H%M%S)"
WORK="$(mktemp -d)"
manifest="$WORK/job.json"
OWNED=0 ACQUIRED=0 started=0 terminal=0
cleanup() {
  local code=$?
  trap - EXIT
  if [[ $OWNED == 1 ]]; then
    if [[ $started == 0 || $terminal == 1 ]]; then writer_release || code=1
    else echo "Writer lock retained for operation $RUN; inspect job/$job before resume." >&2; fi
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT
lock_acquire writer
"${k[@]}" create job "$job" --from=cronjob/radar-refresh-pv --dry-run=client -o json |
  jq --arg mode "--$mode" '
    .spec.template.spec.containers |= map(if .name == "refresh-pv" then
      .command = ["/usr/bin/flock", "-n", "/keyring/runtime/.refresh.lock", "node",
        "dist/scripts/reannotate-signals.js", $mode] | del(.args) else . end)
    | .spec.template.metadata.labels["app.kubernetes.io/instance"] = "radar-reannotate-signals"
    | .spec.ttlSecondsAfterFinished = 86400' > "$manifest"
"${k[@]}" create -f "$manifest"
started=1
echo "Reannotation $mode started: $namespace/$job; schedules remain unchanged."
# Logs contain the JSON report. A failed Job remains available for inspection/retry.
deadline=$(( $(date +%s) + 19800 ))
while :; do
  state="$("${k[@]}" get job "$job" -o json)"
  if jq -e 'any(.status.conditions[]?; .type=="Complete" and .status=="True")' <<< "$state" >/dev/null; then terminal=1; break; fi
  if jq -e 'any(.status.conditions[]?; .type=="Failed" and .status=="True")' <<< "$state" >/dev/null; then
    terminal=1
    "${k[@]}" logs "job/$job"; exit 1
  fi
  if (( $(date +%s) >= deadline )); then echo "Timeout; inspect job/$job" >&2; exit 1; fi
  sleep 15
done
"${k[@]}" logs "job/$job"
