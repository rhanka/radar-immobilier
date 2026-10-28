#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
action=${1:-}
source tools/make/base-preprod-common.sh
operator_inputs
trap 'find "$OUTPUT" -type f ! -name checksums.txt -exec sha256sum "{}" + > "$OUTPUT/checksums.txt"' EXIT
source tools/make/base-preprod-collect.sh
case $action in
validate) ;;
render-job) render_job "$(jq -r .operation "$INPUT")";;
collect-job) collect_job "$(jq -r .operation "$INPUT")";;
permissions|inventory|freeze-cd|close|verify-closed|restore-ingresses|stop-job|collect-maintenance|start-api|tunnel-api|restart-api|reopen-api)
  source tools/make/base-preprod-maintenance.sh
  "$action";;
inspect|init|attach|activate|resume)
  render_job "$action"
  source tools/make/base-preprod-maintenance.sh
  permissions
  if [[ $action == activate || $action == resume ]]; then assert_closed; assert_mcp; fi
  # Create only: an existing Job is never patched, replaced or automatically deleted.
  "${k[@]}" create -f "$OUTPUT/job.json" > "$OUTPUT/create.txt"
  wait_job || true
  collect_job "$action"
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
