#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RESULTS="$ROOT/docs/reviews/refresh-benchmark/v101"
PID_FILE="$RESULTS/campaign.pid"
ENV_NAME=test-t1-model-benchmark

mkdir -p "$RESULTS/logs"
printf '%s\n' "$$" > "$PID_FILE"

children=""
stop_children() {
  for child in $children; do kill -TERM "$child" 2>/dev/null || true; done
  wait || true
  exit 0
}
trap stop_children TERM INT

BENCHMARK_MARK_LAUNCHED=1 make -C "$ROOT/tools/refresh-benchmark" \
  init-campaign-v101 ENV="$ENV_NAME"

run_lane() {
  lane="$1"
  make -C "$ROOT/tools/refresh-benchmark" run-v101-lane LANE="$lane" ENV="$ENV_NAME" \
    >> "$RESULTS/logs/_${lane}.log" 2>&1
}

for lane in cloud openai anthropic mistral; do
  run_lane "$lane" & children="$children $!"
done
if jq -e '.proved == true' "$RESULTS/gates/codex-cap.json" >/dev/null; then
  run_lane codex & children="$children $!"
fi
wait
