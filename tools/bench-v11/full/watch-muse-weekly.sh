#!/bin/bash
# bench-v11: weekly Muse seat watchdog for the Ember arms.
# Usage: watch-muse-weekly.sh <runnerPgid> [intervalSeconds=600] [stopPct=85]
# Reads `muse usage --json` (no model turn) every interval and appends it to
# full/muse-weekly-log.jsonl. At or above stopPct, touches STOP in every
# arms/muse-ember-* dir and kills the runner process group (in-flight docs are
# then missing, never counted as refusals). Exits when the group is gone.
# Note: `timeout` gives each muse exec its own process group, so the muse
# processes are also killed by their exact runner command signature.
PGID="$1"
INTERVAL="${2:-600}"
STOP_PCT="${3:-85}"
DIR="${BENCH_DIR:-$(cd "$(dirname "$0")/.." && pwd)}/full"
LOG="$DIR/muse-weekly-log.jsonl"
while true; do
  RAW=$(muse usage --json 2>/dev/null)
  W=$(echo "$RAW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).allowance?.weekly?.usedPercent ?? "")}catch{console.log("")}})')
  WIN=$(echo "$RAW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).allowance?.window?.usedPercent ?? "")}catch{console.log("")}})')
  echo "{\"at\":\"$(date -u +%FT%TZ)\",\"weeklyUsedPercent\":${W:-null},\"windowUsedPercent\":${WIN:-null}}" >> "$LOG"
  if [ -n "$W" ] && [ "$W" -ge "$STOP_PCT" ]; then
    for A in "$DIR"/arms/muse-ember-*; do touch "$A/STOP"; done
    echo "{\"at\":\"$(date -u +%FT%TZ)\",\"event\":\"WATCHDOG-STOP\",\"weeklyUsedPercent\":$W}" >> "$LOG"
    kill -TERM -- "-$PGID" 2>/dev/null
    # `timeout` puts each muse exec in its own process group: kill the arm's
    # muse processes by their exact command signature (unique to this runner).
    pkill -TERM -f "muse exec --provider meta --model muse-ember-1.0 --contributor-mode off" 2>/dev/null
    exit 0
  fi
  if ! kill -0 -- "-$PGID" 2>/dev/null; then
    echo "{\"at\":\"$(date -u +%FT%TZ)\",\"event\":\"WATCHDOG-END\"}" >> "$LOG"
    exit 0
  fi
  sleep "$INTERVAL"
done
