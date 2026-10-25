#!/usr/bin/env bash
# Reuse BASE archive, ownership and cleanup guards without weakening them.
set -euo pipefail
mode=${1:?}
case $mode in test|check|mutations) ;; *) exit 2;; esac
source tools/make/base-api-guards.sh
require_env
require_scope
[[ $ENV == test-a2base-mcp && $API_PORT == 18921 && $UI_PORT == 15921 && $MAILDEV_UI_PORT == 11921 ]]
[[ -n ${MCP_SCOPE:-} ]]
for path in $MCP_SCOPE; do
  [[ $path =~ ^src/[a-zA-Z0-9_./-]+\.test\.ts$ && $path != *..* && -f packages/immo-mcp/$path ]] || exit 2
done
ROOT=$(pwd -P)
PROJECT=radar-$ENV
TASK_DIR=$ROOT/tmp/a2base-mcp-evidence/$ENV
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$-$mode
mkdir -p "$RUN_DIR" "$LOG_DIR"
printf 'Evidence: %s\n' "$LOG_DIR"
# Wait before acquiring the shared campaign lock, without touching another stack.
while :; do
  names=$(docker ps --format '{{.Names}}')
  free=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
  if [[ -z $names && $free -ge 10485760 ]]; then break; fi
  printf '%s WAIT containers=%s freeKiB=%s\n' "$(date -u +%FT%TZ)" "$names" "$free" | tee -a "$LOG_DIR/wait.log"
  sleep 60
done
exec 9>"$RUN_DIR/lock"
flock -n 9 || exit 2
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
flock -n 8 || exit 2
[[ -z $(docker ps -q) ]]
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
docker() {
  if [[ $1 == compose && " $* " == *' run '* ]]; then command docker "$@";
  else timeout --signal=TERM --kill-after=5 180 docker "$@"; fi
}
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source tools/make/base-api-resources.sh
# Docker can release an auto-removed operator's volume just after compose down.
original_down=$(declare -f guarded_down)
eval "${original_down/#guarded_down/a2base_down_once}"
guarded_down() {
  local attempt
  for attempt in 1 2 3; do
    a2base_down_once && return 0
    sleep 1
  done
  return 1
}
source tools/make/base-api-compose.sh
ACTION=test-api
write_compose
# Prefer the cache completed by the owner-authorized host static qualification.
download_cache=/home/antoinefa/src/radar-immobilier/tmp/a2base-api/tmp/a2base-api-evidence/host/npm-cache/_cacache
[[ -d $download_cache ]] || download_cache=$HOME/.npm/_cacache
if [[ -d $download_cache && ! -L $download_cache ]]; then
  cat > "$RUN_DIR/cache.yml" <<YAML
services:
  api:
    volumes:
      - $download_cache:/download-cache:ro
YAML
  compose+=(-f "$RUN_DIR/cache.yml")
fi
archive_sources
source tools/make/base-api-ci-archive.sh
archive_ci_inputs
tar -rf "$RUN_DIR/source.tar" packages/immo-mcp/src/fixtures/immo-tools.v1.json \
  packages/immo-mcp/src/fixtures/immo-tools.provenance.v1.json \
  packages/immo-mcp/src/fixtures/immo-deployed-baseline.v1.json \
  packages/immo-mcp/config/immo-tools.v1.json packages/immo-mcp/config/immo-artifacts.v1.json \
  tools/h4-mcp.mk deploy/k8s/41-immo-mcp-ingress.yaml
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
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
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-a2mcp-container.sh "$@"' -- "$mode" "$SCOPE" "$MCP_SCOPE" \
  > >(tee "$LOG_DIR/$mode.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
[[ $mode == check ]] || assert_tests_ran "$LOG_DIR/tests.tsv"
if [[ $mode != check ]]; then
  SCOPE=$MCP_SCOPE assert_tests_ran "$LOG_DIR/mcp-tests.tsv"
fi
printf 'PASS %s\n' "$mode" > "$LOG_DIR/result"
