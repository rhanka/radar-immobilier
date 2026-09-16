#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RESULTS="$ROOT/docs/reviews/refresh-benchmark/v101b"
REPLAY="$RESULTS/codex-replay"
STATUS="$REPLAY/status.json"
PUBLIC_STATUS="$RESULTS/status-codex.json"
ENV_NAME=test-t1-model-benchmark
ARMS="luna-low luna-medium luna-high luna-xhigh sol-low sol-medium sol-high sol-xhigh astra-low astra-medium astra-high astra-xhigh"

test "$(jq -r '.proved' "$RESULTS/gates/codex-400-diagnostic.json")" = "true"
mkdir -p "$REPLAY/gates"
printf '%s\n' "$$" > "$RESULTS/codex-replay.pid"

child=""
stop_child() {
  test -z "$child" || kill -TERM "$child" 2>/dev/null || true
  wait || true
  exit 0
}
trap stop_child TERM INT

run_arm() {
  arm="$1" slice="$2" concurrency="$3"
  make -C "$ROOT/tools/refresh-benchmark" run-v101-arm ARM="$arm" SLICE="$slice" \
    CONCURRENCY="$concurrency" RUN_ROOT=/results/codex-replay V101_CAMPAIGN=v101b \
    ENV="$ENV_NAME" &
  child=$!
  wait "$child"
  child=""
  temporary="$PUBLIC_STATUS.$$"
  jq '.statusSource = "codex-replay/status.json"' "$STATUS" > "$temporary"
  mv "$temporary" "$PUBLIC_STATUS"
}

passed=0
consecutive_open=0
for arm in $ARMS; do
  run_arm "$arm" 1-3 1
  state=$(jq -r --arg arm "$arm" '.arms[$arm].state' "$STATUS")
  if jq -e --arg arm "$arm" '.arms[$arm] | .requests == 3 and .processed == 3
    and .errors == 0 and .state == "running"' "$STATUS" >/dev/null; then
    gate=true
    passed=$((passed + 1))
  else
    gate=false
  fi
  temporary="$REPLAY/gates/$arm.json.$$"
  jq -n --arg arm "$arm" --arg state "$state" --argjson passed "$gate" \
    '{schemaVersion:1, arm:$arm, requiredRequests:3, passed:$passed, state:$state,
      redaction:{allowlistedFieldsOnly:true,secretsIncluded:false}}' > "$temporary"
  mv "$temporary" "$REPLAY/gates/$arm.json"
  if test "$state" = "circuit-open"; then
    consecutive_open=$((consecutive_open + 1))
  else
    consecutive_open=0
  fi
  test "$consecutive_open" -lt 2 || exit 2
done

test "$passed" -eq 12 || exit 3
consecutive_open=0
for arm in $ARMS; do
  run_arm "$arm" 4-100 2
  state=$(jq -r --arg arm "$arm" '.arms[$arm].state' "$STATUS")
  if test "$state" = "circuit-open"; then
    consecutive_open=$((consecutive_open + 1))
  else
    consecutive_open=0
  fi
  test "$consecutive_open" -lt 2 || exit 2
done
