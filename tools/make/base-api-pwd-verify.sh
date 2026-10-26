#!/usr/bin/env bash
# Standalone, no environment-file discovery; one serial disposable campaign.
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-api-paniers-pwd && $API_PORT == 18932 && $UI_PORT == 15932 && $MAILDEV_UI_PORT == 11932 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
ACTION=ci-api
SCOPE=${PWD_SCOPE:-$(git ls-files --cached --others --exclude-standard -- api/src/services/facets/pw-write-*.test.ts api/src/services/facets/signal-write-*.test.ts api/tests/integration/pw-write-*.spec.ts | sed 's#^api/##')}
require_scope
RUN_DIR=$ROOT/tmp/pwd-evidence/runtime
LOG_DIR=$ROOT/tmp/pwd-evidence/$(date -u +%Y%m%dT%H%M%S)-campaign
mkdir -p "$RUN_DIR" "$LOG_DIR"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
until flock -w 10 8; do echo 'Waiting for another Docker campaign'; done
free_space() {
  [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 8388608 &&
     $(awk '/MemAvailable:/ {print $2}' /proc/meminfo) -ge 8388608 ]]
}
# Wait without touching another campaign's containers, volumes, or builders.
while :; do
  free_space || { echo 'STOP: less than 8 GiB disk or available memory'; exit 3; }
  running=$(docker ps --filter name=radar-test- --format '{{.Names}}')
  builders=$(ps -eo comm=,args= | awk '$1 ~ /^(docker|docker-buildx|buildctl)$/ && $0 ~ / (build|buildx) /')
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
if [[ -f $ROOT/tmp/pwd-evidence/corrections/repro-once.tar ]]; then
  tar -Af "$RUN_DIR/source.tar" "$ROOT/tmp/pwd-evidence/corrections/repro-once.tar"
  mv "$ROOT/tmp/pwd-evidence/corrections/repro-once.tar" "$LOG_DIR/repro-source.tar"
fi
git ls-files --cached --others --exclude-standard -- 'api/tests/*.ts' \
  | while IFS= read -r file; do
    relative=${file#api/tests/}
    [[ $relative != */* && ! -L $file ]] || continue
    tar -rf "$RUN_DIR/source.tar" "$file"
    printf '%s\n' "$file" >> "$LOG_DIR/archived-paths.txt"
  done
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
df -Pk "$ROOT" > "$LOG_DIR/disk-before.log"
awk '/MemAvailable:/ {print}' /proc/meminfo > "$LOG_DIR/memory-before.log"
printf '%s\n' "$LOG_DIR" | tee "$ROOT/tmp/pwd-evidence/latest"
git rev-parse HEAD > "$LOG_DIR/head.txt"
(
  while sleep 5; do
    free_space || { echo 'STOP: resource floor breached' > "$LOG_DIR/resource-stop.log"; kill -TERM "$$"; exit; }
  done
) 8>&- > "$LOG_DIR/resource-monitor.log" 2>&1 &
MONITOR=$!
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-pwd-container.sh "$1" "$2"' -- "$SCOPE" "${PWD_MODE:-full}" \
  > >(tee "$LOG_DIR/campaign.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
assert_tests_ran "$LOG_DIR/tests.tsv"
echo 'PASS PW-D campaign' > "$LOG_DIR/result"
