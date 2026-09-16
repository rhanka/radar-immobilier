#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RESULTS="$ROOT/docs/reviews/refresh-benchmark/v101b"
ENV_NAME=test-t1-model-benchmark

test "$(jq -r '.version' "$RESULTS/gates/llm-mesh-install.json")" = "0.19.3"
test "$(jq -r '.cap.enforced' "$RESULTS/gates/codex-cap-assessment.json")" = "true"
for provider in cloud codex anthropic; do
  jq -e '.outcomes | length == 3 and all(.requestCount == 1 and (.noActiveAccount | not))' \
    "$RESULTS/gates/provider-$provider.json" >/dev/null
done
test -f "$RESULTS/manifest.json" -a -f "$RESULTS/status.json"

mkdir -p "$RESULTS/logs"
printf '%s\n' "$$" > "$RESULTS/campaign.pid"
launched_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
status_tmp="$RESULTS/status.json.$$"
jq --arg at "$launched_at" '.launchedAt = $at | .updatedAt = $at' \
  "$RESULTS/status.json" > "$status_tmp"
mv "$status_tmp" "$RESULTS/status.json"

children=""
stop_children() {
  for child in $children; do kill -TERM "$child" 2>/dev/null || true; done
  wait || true
  exit 0
}
trap stop_children TERM INT

run_lane() {
  lane="$1"
  make -C "$ROOT/tools/refresh-benchmark" run-v101-lane LANE="$lane" \
    V101_CAMPAIGN=v101b ENV="$ENV_NAME" >> "$RESULTS/logs/_${lane}.log" 2>&1
}
for lane in cloud codex anthropic; do
  run_lane "$lane" & children="$children $!"
done
wait
