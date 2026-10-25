#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
action=${1:-}
source tools/make/base-preprod-common.sh
operator_inputs
case $action in
validate) ;;
render-job) render_job "$(jq -r .operation "$INPUT")";;
permissions|inventory|freeze-cd|close|stop-job|collect-maintenance|start-api|restart-api|reopen-api)
  source tools/make/base-preprod-maintenance.sh
  "$action";;
inspect|init|attach|activate|resume)
  render_job "$action"
  source tools/make/base-preprod-maintenance.sh
  permissions
  if [[ $action == activate || $action == resume ]]; then assert_closed; assert_mcp; fi
  # Create only: an existing Job is never patched, replaced or automatically deleted.
  "${k[@]}" create -f "$OUTPUT/job.json" > "$OUTPUT/create.txt"
  "${k[@]}" wait --for=condition=complete "job/$job" --timeout=570s > "$OUTPUT/wait.txt" || {
    echo 'Job not complete; retain Job and evidence for diagnosis' >&2; exit 2;
  }
  "${k[@]}" get pods -l "job-name=$job" -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.terminated.message}{"\n"}{end}' > "$OUTPUT/termination.json"
  jq -e --slurpfile c "$INPUT" '.status=="complete" and .binding==$c[0].binding' "$OUTPUT/termination.json" >/dev/null
  "${k[@]}" logs "job/$job" -c operator > "$OUTPUT/receipt.json"
  [[ $(sha256sum "$OUTPUT/receipt.json" | cut -d' ' -f1) == $(jq -r .sha256 "$OUTPUT/termination.json") ]] || fail 'Receipt hash mismatch'
  jq -e --slurpfile c "$INPUT" --arg action "$action" '.binding==$c[0].binding and .action==$action and (.result|type=="object")' "$OUTPUT/receipt.json" >/dev/null
  ;;
delete-job)
  # Deletion is separate from successful collection, and needs the collected receipt.
  regular_json "${PROOFS:-}"
  jq -e --slurpfile c "$INPUT" '.binding==$c[0].binding and .status=="complete" and (.sha256|length==64)' "$PROOFS" >/dev/null
  "${k[@]}" get pods -l "job-name=$job" -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.terminated.message}{"\n"}{end}' > "$OUTPUT/current-termination.json"
  jq -e --slurpfile saved "$PROOFS" '.==$saved[0]' "$OUTPUT/current-termination.json" >/dev/null || fail 'Saved receipt does not identify current Job'
  source tools/make/base-preprod-maintenance.sh
  delete_job_uid "$job" "$("${k[@]}" get job "$job" -o jsonpath='{.metadata.uid}')";;
*) fail 'Unknown operator action';;
esac
find "$OUTPUT" -type f ! -name checksums.txt -exec sha256sum '{}' + > "$OUTPUT/checksums.txt"
