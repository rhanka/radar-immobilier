#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RESULTS="$ROOT/docs/reviews/refresh-benchmark/v101"
ENV_NAME=test-t1-model-benchmark

printf '%s\n' "$$" > "$RESULTS/codex.pid"
make -C "$ROOT/tools/refresh-benchmark" enroll-codex-v101 ENV="$ENV_NAME"
exec make -C "$ROOT/tools/refresh-benchmark" run-v101-lane LANE=codex ENV="$ENV_NAME"
