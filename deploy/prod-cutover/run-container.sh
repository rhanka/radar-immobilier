#!/usr/bin/env bash
set -euo pipefail
run=$1
shift
node deploy/prod-cutover/containers.cjs guard "$run"
child=
cleanup() {
  local code=$?
  trap - EXIT
  node deploy/prod-cutover/containers.cjs stop "$run" || code=1
  if [[ -n $child ]]; then kill -KILL "$child" 2>/dev/null || :; wait "$child" || :; fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
timeout --foreground --signal=TERM --kill-after=5s "${CUTOVER_CONTAINER_TIMEOUT:-550}s" docker "$@" &
child=$!
wait "$child"
