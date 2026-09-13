#!/usr/bin/env bash
set -euo pipefail
: "${REPORT_DIR:?}" "${ELAPSED_SECONDS:?}"
if [ -s "$REPORT_DIR/summary.json" ]; then
  cat "$REPORT_DIR/summary.json"
elif [ -s "$REPORT_DIR/progress.json" ]; then
  cat "$REPORT_DIR/progress.json"
else
  printf '{"expected":59017,"processed":0,"matching":0,"copied":0,"failed":0,"logicalBytes":0,"elapsedSeconds":%s,"opsPerSecond":0,"logicalMiBPerSecond":0,"etaSeconds":null}\n' \
    "$ELAPSED_SECONDS"
  exit
fi
