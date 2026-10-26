#!/usr/bin/env bash
# Standalone, no environment-file discovery; one serial disposable campaign.
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-api-paniers-w && $API_PORT == 18928 && $UI_PORT == 15928 && $MAILDEV_UI_PORT == 11928 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
ACTION=ci-api
SCOPE=$(git ls-files --cached --others --exclude-standard -- api/src/services/facets/signal-write-*.test.ts api/tests/integration/base-api-pwb-*.spec.ts | sed 's#^api/##')
require_scope
RUN_DIR=$ROOT/tmp/pwb-evidence/runtime
LOG_DIR=$ROOT/tmp/pwb-evidence/$(date -u +%Y%m%dT%H%M%S)-campaign
mkdir -p "$RUN_DIR" "$LOG_DIR"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
flock -n 8 || { echo 'Another Docker campaign is active'; exit 2; }
free_space() {
  [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 8388608 &&
     $(awk '/MemAvailable:/ {print $2}' /proc/meminfo) -ge 8388608 ]]
}
# Wait without touching another campaign's containers, volumes, or builders.
while :; do
  free_space || { echo 'STOP: less than 8 GiB disk or available memory'; exit 3; }
  running=$(docker ps --filter name=radar-test- --format '{{.Names}}')
  builders=$(ps -eo comm=,args= | awk '$1 ~ /^(docker|buildctl)$/ && $0 ~ / (build|buildx) /')
  [[ -n $running || -n $builders ]] || break
  echo 'Waiting for radar test containers and Docker builds to finish'; sleep 10
done
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
docker() {
  if [[ $1 == compose && " $* " == *' run '* ]]; then command docker "$@";
  else timeout --signal=TERM --kill-after=5 180 docker "$@"; fi
}
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source tools/make/base-api-resources.sh
source tools/make/base-api-compose.sh
source tools/make/base-api-ci-archive.sh
write_compose
archive_sources
archive_ci_inputs
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
df -Pk "$ROOT" > "$LOG_DIR/disk-before.log"
awk '/MemAvailable:/ {print}' /proc/meminfo > "$LOG_DIR/memory-before.log"
printf '%s\n' "$LOG_DIR" | tee "$ROOT/tmp/pwb-evidence/latest"
git rev-parse HEAD > "$LOG_DIR/head.txt"
(
  while sleep 5; do
    free_space || { echo 'STOP: resource floor breached' > "$LOG_DIR/resource-stop.log"; kill -TERM "$$"; exit; }
  done
) 8>&- > "$LOG_DIR/resource-monitor.log" 2>&1 &
MONITOR=$!
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-pwb-container.sh "$1"' -- "$SCOPE" \
  > >(tee "$LOG_DIR/campaign.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
assert_tests_ran "$LOG_DIR/tests.tsv"
echo 'PASS PW-B campaign' > "$LOG_DIR/result"
