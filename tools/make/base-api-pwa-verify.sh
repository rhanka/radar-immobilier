#!/usr/bin/env bash
# One disposable stack, without environment-file discovery or host runtimes.
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-api-paniers-pwa && $API_PORT == 18933 && $UI_PORT == 15933 && $MAILDEV_UI_PORT == 11933 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
ACTION=ci-api
SCOPE=${SCOPE:-$(git ls-files --cached --others --exclude-standard -- 'api/src/artifacts/write-*.test.ts' 'api/tests/integration/pw-write-authority*.spec.ts' | sed 's#^api/##')}
require_scope
RUN_DIR=$ROOT/tmp/pwa-evidence/runtime
LOG_DIR=$ROOT/tmp/pwa-evidence/$(date -u +%Y%m%dT%H%M%S)-campaign
mkdir -p "$RUN_DIR" "$LOG_DIR"
printf '%s\n' "$LOG_DIR" | tee "$ROOT/tmp/pwa-evidence/latest"
free_space() {
  [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 8388608 &&
     $(awk '/MemAvailable:/ {print $2}' /proc/meminfo) -ge 8388608 ]]
}
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
until flock -w 10 8; do
  free_space || { echo 'STOP: less than 8 GiB disk or memory'; exit 3; }
  echo 'Waiting for the Docker campaign lock'
done
while :; do
  free_space || { echo 'STOP: less than 8 GiB disk or memory'; exit 3; }
  running=$(docker ps --filter name=radar-test- --format '{{.Names}}')
  builders=$(ps -eo comm=,args= | awk '$1 ~ /^(docker|buildctl)$/ && $0 ~ / (build|buildx) /')
  [[ -n $running || -n $builders ]] || break
  echo 'Waiting for radar test containers and Docker builds'; sleep 10
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
git ls-files --cached --others --exclude-standard -- 'api/tests/*.ts' | while IFS= read -r file; do
  relative=${file#api/tests/}
  [[ $relative != */* && ! -L $file ]] || continue
  tar -rf "$RUN_DIR/source.tar" "$file"
done
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
sort -u "$LOG_DIR/archived-paths.txt" | xargs -d '\n' sha256sum > "$LOG_DIR/files.sha256"
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
git rev-parse HEAD > "$LOG_DIR/head.txt"
git diff HEAD --no-ext-diff > "$LOG_DIR/target.diff"
sha256sum "$LOG_DIR/target.diff" > "$LOG_DIR/target.sha256"
(
  while sleep 5; do
    free_space || { echo 'STOP: resource floor breached' > "$LOG_DIR/resource-stop.log"; kill -TERM "$$"; exit; }
  done
) 8>&- > "$LOG_DIR/resource-monitor.log" 2>&1 &
MONITOR=$!
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-pwa-container.sh "$1"' -- "$SCOPE" \
  > >(tee "$LOG_DIR/campaign.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
assert_tests_ran "$LOG_DIR/tests.tsv"
echo 'PASS PW-A campaign' > "$LOG_DIR/result"
