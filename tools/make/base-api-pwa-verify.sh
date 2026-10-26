#!/usr/bin/env bash
# One disposable stack, without environment-file discovery or host runtimes.
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-api-paniers-pwa && $API_PORT == 18933 && $UI_PORT == 15933 && $MAILDEV_UI_PORT == 11933 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
ACTION=ci-api
PWA_MODE=${PWA_MODE:-full}
[[ $PWA_MODE == full || $PWA_MODE == mcp || $PWA_MODE == scoped ]]
SCOPE=${SCOPE:-$(git ls-files --cached --others --exclude-standard -- 'api/src/artifacts/write-*.test.ts' \
  'api/tests/integration/pw-write-authority*.spec.ts' api/tests/integration/pw-write-createapp.spec.ts \
  'api/src/services/facets/pw-write-*.test.ts' | sed 's#^api/##')}
require_scope
RUN_DIR=$ROOT/tmp/pwa-evidence/runtime
LOG_DIR=$ROOT/tmp/pwa-evidence/$(date -u +%Y%m%dT%H%M%S)-campaign
mkdir -p "$RUN_DIR" "$LOG_DIR"
printf '%s\n' "$LOG_DIR" | tee "$ROOT/tmp/pwa-evidence/latest"
printf '%s\n' "$LOG_DIR" > "$ROOT/tmp/pwa-evidence/latest-$PWA_MODE"
printf '%s\n' "$PWA_MODE" > "$LOG_DIR/mode.txt"
free_space() {
  [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 8388608 &&
     $(awk '/MemAvailable:/ {print $2}' /proc/meminfo) -ge 8388608 ]]
}
deadline=$((SECONDS + 21600))
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
while :; do
  (( SECONDS < deadline )) || { echo 'Docker reservation exceeded six hours'; exit 4; }
  free_space || { echo 'STOP: less than 8 GiB disk or memory'; exit 3; }
  running=$(docker ps --filter name=test- --format '{{.Names}}')
  builders=$(ps -eo comm=,args= | awk '$1 ~ /^(docker|docker-buildx|buildctl)$/ && $0 ~ / (build|buildx) /')
  if [[ -z $running && -z $builders ]] && flock -n 8; then
    running=$(docker ps --filter name=test- --format '{{.Names}}')
    builders=$(ps -eo comm=,args= | awk '$1 ~ /^(docker|docker-buildx|buildctl)$/ && $0 ~ / (build|buildx) /')
    [[ -n $running || -n $builders ]] || break
    flock -u 8
  fi
  echo 'Waiting for radar test containers, Docker builds and campaign lock'; sleep 10
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
git ls-files --cached --others --exclude-standard -- 'packages/immo-mcp/config/*.json' \
  'packages/immo-mcp/src/fixtures/*.json' tools/h4-mcp.mk deploy/k8s/41-immo-mcp-ingress.yaml \
  | while IFS= read -r file; do
    part=$file
    while [[ $part != . ]]; do
      [[ ! -L $part ]] || exit 2
      if [[ $part == */* ]]; then part=${part%/*}; else part=.; fi
    done
    tar -rf "$RUN_DIR/source.tar" "$file"
    printf '%s\n' "$file" >> "$LOG_DIR/archived-paths.txt"
  done
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
docker image inspect --format '{{.Id}} {{json .RepoDigests}}' \
  node:24-bookworm-slim postgis/postgis:16-3.4 adobe/s3mock:3.12.0 > "$LOG_DIR/image-ids.txt"
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-pwa-container.sh "$1" "$2"' -- "$SCOPE" "$PWA_MODE" \
  > >(tee "$LOG_DIR/campaign.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
if [[ $PWA_MODE != mcp ]]; then assert_tests_ran "$LOG_DIR/tests.tsv"; fi
echo 'PASS PW-A campaign' > "$LOG_DIR/result"
