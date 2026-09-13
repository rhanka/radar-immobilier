#!/usr/bin/env bash
set -euo pipefail
: "${REPORT_DIR:?}" "${ELAPSED_SECONDS:?}"
shopt -s nullglob
results=("$REPORT_DIR"/results/*.json)
if [ "${#results[@]}" -eq 0 ]; then
  jq -n --argjson elapsedSeconds "$ELAPSED_SECONDS" \
    '{expected:59017,processed:0,matching:0,copied:0,failed:0,logicalBytes:0,
      elapsedSeconds:$elapsedSeconds,opsPerSecond:0,logicalMiBPerSecond:0,etaSeconds:null}'
  exit
fi
jq -s --argjson elapsedSeconds "$ELAPSED_SECONDS" '
  {expected:59017,processed:length,
   matching:(map(select(.status == "matching"))|length),
   copied:(map(select(.status == "copied"))|length),
   failed:(map(select(.status == "failed"))|length),
   logicalBytes:(map(.size)|add),elapsedSeconds:$elapsedSeconds} |
  . + {opsPerSecond:(.processed / ([.elapsedSeconds,1]|max)),
       logicalMiBPerSecond:(.logicalBytes / 1048576 / ([.elapsedSeconds,1]|max)),
       etaSeconds:(if .processed == 0 then null else
         (((.expected-.processed) / (.processed / ([.elapsedSeconds,1]|max)))|ceil) end)}' \
  "${results[@]}"
