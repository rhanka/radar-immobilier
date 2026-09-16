#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RESULTS="$ROOT/docs/reviews/refresh-benchmark/v101b"
ENV_NAME=test-t1-model-benchmark
JUDGES="judge-terra judge-opus46-thinking"

mkdir -p "$RESULTS/judges/logs"
printf '%s\n' "$$" > "$RESULTS/judges/judges.pid"
children=""

stop_children() {
  for child in $children; do kill -TERM "$child" 2>/dev/null || true; done
  wait || true
  exit 0
}
trap stop_children TERM INT

for judge in $JUDGES; do
  make -C "$ROOT/tools/refresh-benchmark" run-v101-arm ARM="$judge" SLICE=1-650 \
    CONCURRENCY=1 V101_CAMPAIGN=v101b ENV="$ENV_NAME" \
    >> "$RESULTS/judges/logs/$judge.log" 2>&1 &
  children="$children $!"
done
wait
