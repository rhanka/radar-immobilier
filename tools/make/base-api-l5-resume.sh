#!/usr/bin/env bash
set -euo pipefail
export COMPOSE_ANSI=never COMPOSE_PROGRESS=plain
phase=${PHASE:?}
controller="$PWD/tmp/l5-evidence/controller"
mkdir -p "$controller"
exec 9>"$controller/qualification.lock"
flock 9
printf '%s\n' "$$" > "$controller/pid"
child=
stop() {
  trap - INT TERM
  if [[ -n $child ]]; then
    kill -TERM -- "-$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 130
}
trap stop INT TERM
target=l5-verify; pointer=latest
if [[ $phase == images ]]; then target=l5-images; pointer=latest-images; fi
ROOT=$(pwd -P)
RUN_DIR=$ROOT/tmp/l5-evidence/runtime
[[ $phase != images ]] || RUN_DIR=$ROOT/tmp/l5-evidence/images-runtime
LOG_DIR=$controller/recovery-$phase-$(date -u +%Y%m%dT%H%M%S)
mkdir -p "$LOG_DIR"
source tools/make/base-api-guards.sh
source tools/make/base-api-l5-lock.sh
recover_l5_resources
while :; do
  previous=$(cat "tmp/l5-evidence/$pointer" 2>/dev/null || true)
  set +e
  setsid rtk make -f tools/make/base-api-l5.mk "$target" PHASE="$phase" SCOPE="${SCOPE:-}" MUTANTS="${MUTANTS:-}" \
    API_PORT=18935 UI_PORT=15935 MAILDEV_UI_PORT=11935 ENV="$ENV" 9>&- &
  child=$!
  wait "$child"
  code=$?
  child=
  set -e
  current=$(cat "tmp/l5-evidence/$pointer" 2>/dev/null || true)
  if [[ $code == 0 ]]; then
    printf '%s\t%s\n' "$phase" "$current" | tee -a "$controller/completed.tsv"
    exit 0
  fi
  if [[ $current != "$previous" && ( -s $current/occupancy-stop.txt || -s $current/foreign-stack.txt ) ]]; then
    printf '%s\t%s\t%s\n' "$phase" "$code" "$current" >> "$controller/foreign-retries.tsv"
    echo 'Foreign interruption retained; waiting for departure before retrying'
    continue
  fi
  printf 'Qualification needs investigation: %s exit=%s evidence=%s\n' "$phase" "$code" "$current"
  exit "$code"
done
