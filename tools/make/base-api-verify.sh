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
  ci-api)
    # Vitest runs its complete CI include list; required B4 cases may not skip.
    SCOPE='tests/integration/base-api-activation.spec.ts tests/integration/base-api-activation-resume.spec.ts tests/integration/base-api-legacy.spec.ts tests/integration/base-api-cutover-bound.spec.ts'
    require_scope;;
  input-guards) for file in "$TOOLS"/base-api*.sh; do bash -n "$file"; done; exit;;
  check-scope) scope_check; exit;;
  b3-mutation-required|b4-mutation-required|b5-mutation-required)
    require_scope
    runner="$TOOLS/base-api-${ACTION%%-*}-mutation.sh"
    [[ -s $runner && ! -L $runner ]] || { echo "Missing required mutation runner: ${runner##*/}" >&2; exit 2; };;
  b5-verify|verify|test|test-api|b1-mutation-legacy|b1-mutation-archive|b1-mutation-required) require_scope;;
  typecheck|lint|network-proof|clean) ;;
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
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
flock -n 8 || { echo 'Another Docker campaign is active' >&2; exit 2; }
if [[ $ACTION == b5-* ]]; then
  [[ -z $(docker ps -q) ]] || { echo 'STOP: another stack is running' >&2; exit 2; }
fi
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
docker() {
  if [[ $1 == compose && " $* " == *' run '* ]]; then command docker "$@";
  elif [[ $1 == compose && ( " $* " == *' down '* || " $* " == *' up '* ) ]]; then
    timeout --signal=TERM --kill-after=5 180 docker "$@";
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
if [[ $ACTION == ci-api || $ACTION == b5-verify || $ACTION == test-api ]]; then
  source "$TOOLS/base-api-ci-archive.sh"
  archive_ci_inputs
fi
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
) 8>&- 9>&- > "$LOG_DIR/disk-monitor.log" 2>&1 &
MONITOR=$!
export BASE_API_RUN_PID=$$
"${compose[@]}" up -d --wait postgres
if [[ $ACTION == ci-api || $ACTION == b5-verify || $ACTION == test-api ]]; then "${compose[@]}" up -d --wait minio; fi
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash -x tools/make/base-api-container.sh "$@"' -- "$ACTION" "$SCOPE" \
  > >(tee "$LOG_DIR/$ACTION.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
if [[ $ACTION == b5-verify || $ACTION == verify || $ACTION == ci-api || $ACTION == test || $ACTION == test-api || $ACTION == *-mutation-* ]]; then assert_tests_ran "$LOG_DIR/tests.tsv"; fi
echo "PASS $ACTION" > "$LOG_DIR/result"
