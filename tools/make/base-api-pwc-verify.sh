#!/usr/bin/env bash
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-api-paniers-pwc && $API_PORT == 18934 && $UI_PORT == 15934 && $MAILDEV_UI_PORT == 11934 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
ACTION=ci-api
RUN_DIR=$ROOT/tmp/pwc-evidence/runtime
LOG_DIR=$ROOT/tmp/pwc-evidence/$(date -u +%Y%m%dT%H%M%S)-${PHASE:-baseline}
mkdir -p "$RUN_DIR" "$LOG_DIR"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
while :; do
  running=$(docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}}' | awk '$1 ~ /^(radar-)?test-/ || $2 ~ /^(radar-)?test-/')
  if [[ -z $running ]] && flock -w 1 8; then
    running=$(docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}}' | awk '$1 ~ /^(radar-)?test-/ || $2 ~ /^(radar-)?test-/')
    [[ -n $running ]] || break
    flock -u 8
  fi
  echo 'Waiting for another test stack or shared campaign lock'; sleep 10
done
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 8388608 ]]
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source tools/make/base-api-resources.sh
source tools/make/base-api-compose.sh
source tools/make/base-api-ci-archive.sh
write_compose
archive_sources
archive_ci_inputs
pwc_tests=(api/tests/*.ts)
for path in "${pwc_tests[@]}"; do [[ -f $path && ! -L $path ]]; done
tar -rf "$RUN_DIR/source.tar" "${pwc_tests[@]}" deploy/k8s/nginx/check-header-parity.sh deploy/k8s/nginx/default.conf ui/nginx/default.conf
printf '%s\n' "${pwc_tests[@]}" >> "$LOG_DIR/archived-paths.txt"
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
printf '%s\n' "$LOG_DIR" | tee "$ROOT/tmp/pwc-evidence/latest"
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-pwc-container.sh "$1"' -- "${PHASE:-baseline}" \
  > >(tee "$LOG_DIR/campaign.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
