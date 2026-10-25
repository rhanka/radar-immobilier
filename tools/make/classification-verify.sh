#!/usr/bin/env bash
# Reuse BASE source validation, compose isolation, teardown and container gates.
set -euo pipefail
mode=${1:?}
[[ $ENV == test-api-paniers && $API_PORT == 18927 && $UI_PORT == 15927 && $MAILDEV_UI_PORT == 11927 ]]
ROOT=$(pwd -P)
export GIT_DIR=$ROOT/tmp/classification-delivery.git GIT_WORK_TREE=$ROOT
TOOLS=$ROOT/tools/make
source "$TOOLS/base-api-guards.sh"
require_env
PROJECT=radar-$ENV
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
ACTION=test-api
TASK_DIR=$ROOT/tmp/classification-evidence
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$-$mode
mkdir -p "$RUN_DIR" "$LOG_DIR"
echo "Evidence: $LOG_DIR"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
flock -w 3600 8
while [[ -n $(docker ps -q --filter name=radar-test-) ]] || pgrep -f '(^|/)(docker|docker-buildx)([[:space:]]+build(x)?|[[:space:]]+bake)' >/dev/null; do
  echo 'Waiting for Docker to become idle'; sleep 2
done
exec 9>"$RUN_DIR/lock"
flock -n 9
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source "$TOOLS/base-api-resources.sh"
source "$TOOLS/base-api-compose.sh"
source "$TOOLS/base-api-ci-archive.sh"
write_compose
df -h . | tee "$LOG_DIR/disk-before.log"
[[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 10485760 ]] || exit 3
git rev-parse HEAD > "$LOG_DIR/candidate.sha"
git status --short > "$LOG_DIR/worktree-status.txt"
BASE_API_LINT_FILES=$(git diff --name-only 600d78485965361c89109bf61eccaa0250cf7284 -- api/src | tr '\n' ' ')
archive_sources
archive_ci_inputs
for path in tools/make/classification-container.sh tools/make/classification-mutants.mjs; do
  [[ -f $path && ! -L $path ]] || continue
  tar -rf "$RUN_DIR/source.tar" "$path"
done
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
(
  while sleep 10; do
    if [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -lt 8388608 ]]; then
      echo 'STOP: less than 8 GiB free' > "$LOG_DIR/disk-stop.log"
      kill -TERM "$$"; exit
    fi
  done
) 8>&- 9>&- > "$LOG_DIR/disk-monitor.log" 2>&1 &
MONITOR=$!
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/classification-container.sh "$@"' -- "$mode" "${SCOPE:-}" \
  > >(tee "$LOG_DIR/$mode.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
if [[ $mode == targeted ]]; then assert_tests_ran "$LOG_DIR/tests.tsv"; fi
echo "PASS $mode" > "$LOG_DIR/result"
