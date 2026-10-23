#!/usr/bin/env bash
# Standalone BASE campaigns; no environment discovery or host runtime.
set -euo pipefail
ACTION=${1:-}; shift || true
ENV= SCOPE=
for kv in "$@"; do case "$kv" in ENV=*) ENV=${kv#*=};; SCOPE=*) SCOPE=${kv#*=};; esac; done
TOOLS=$(cd -- "$(dirname -- "$0")" && pwd)
source "$TOOLS/base-api-guards.sh"
require_env
case "$ACTION" in
  input-guards) for file in "$TOOLS"/base-api*.sh; do bash -n "$file"; done; exit;;
  check-scope) scope_check; exit;;
  verify|test|test-api) require_scope;;
  typecheck|lint|clean) ;;
  *) echo "Unknown action: $ACTION" >&2; exit 2;;
esac
PROJECT=radar-$ENV
ROOT=$(pwd -P)
TASK_DIR=$ROOT/tmp/base-api-evidence/$ENV
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$-$ACTION
mkdir -p "$RUN_DIR" "$LOG_DIR"
printf 'Evidence: %s\n' "$LOG_DIR"
exec 9>"$RUN_DIR/lock"
flock -n 9 || { echo 'Runner already active' >&2; exit 2; }
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
docker() {
  if [[ $1 == compose && " $* " == *' run '* ]]; then command docker "$@";
  else timeout --signal=TERM --kill-after=5 60 docker "$@"; fi
}
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source "$TOOLS/base-api-resources.sh"
source "$TOOLS/base-api-compose.sh"
write_compose
if [[ $ACTION == clean ]]; then
  trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; exit
fi
df -h "$ROOT" | tee "$LOG_DIR/disk-before.log"
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 10485760 ]] || {
  echo 'STOP: less than 10 GiB free' >&2; exit 3;
}
# Validate all paths using metadata before tar can open any file.
archive_sources
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
(
  while sleep 10; do
    if [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -lt 10485760 ]]; then
      echo 'STOP: less than 10 GiB free' > "$LOG_DIR/disk-stop.log"
      kill -TERM "$$"; exit
    fi
  done
) 9>&- > "$LOG_DIR/disk-monitor.log" 2>&1 &
MONITOR=$!
export BASE_API_RUN_PID=$$
"${compose[@]}" up -d --wait postgres
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash -x tools/make/base-api-container.sh "$@"' -- "$ACTION" "$SCOPE" \
  > >(tee "$LOG_DIR/$ACTION.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
if [[ $ACTION == verify || $ACTION == test || $ACTION == test-api ]]; then assert_tests_ran "$LOG_DIR/tests.tsv"; fi
echo "PASS $ACTION" > "$LOG_DIR/result"
