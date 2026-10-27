#!/usr/bin/env bash
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-api-paniers-pwe || $ENV == e2e-api-paniers-pwe ]]
[[ $API_PORT == 18935 && $UI_PORT == 15935 && $MAILDEV_UI_PORT == 11935 ]]
[[ ${PHASE:-pg} == pg || ${PHASE:-pg} == full || ${PHASE:-pg} == mutations ]]
ROOT=$(pwd -P)
git diff --quiet HEAD
if [[ -z ${SCOPE:-} ]]; then
  SCOPE=$(git ls-files -- 'api/src/artifacts/write-*.test.ts' \
    'api/src/services/facets/pw-write-*.test.ts' 'api/src/services/facets/signal-write-*.test.ts' \
    'api/tests/integration/pw-write*.spec.ts' 'api/tests/integration/pwe-*.spec.ts' | sed 's#^api/##')
fi
require_scope
PROJECT=radar-$ENV
ACTION=ci-api
RUN_DIR=$ROOT/tmp/pwe-evidence/runtime
LOG_DIR=$ROOT/tmp/pwe-evidence/$(date -u +%Y%m%dT%H%M%S)-${PHASE:-pg}
mkdir -p "$RUN_DIR" "$LOG_DIR"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
while :; do
  running=$(docker ps --format '{{.Names}}')
  if [[ -z $running ]] && flock -w 1 8; then
    running=$(docker ps --format '{{.Names}}')
    [[ -n $running ]] || break
    flock -u 8
  fi
  echo 'Waiting for the shared lock and an empty Docker machine'; sleep 10
done
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 8388608 ]]
[[ $(awk '/MemAvailable:/ {print $2}' /proc/meminfo) -ge 8388608 ]]
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source tools/make/base-api-resources.sh
source tools/make/base-api-compose.sh
source tools/make/base-api-ci-archive.sh
write_compose
source tools/make/base-api-pwa-offline.sh
archive_sources
archive_ci_inputs
extra=(api/tests/*.ts api/src/scripts/base-preprod-rights.json tools/h4-mcp.mk
  tools/make/artefacts-delivery-account.sql tools/make/artefacts-delivery-probe.sh
  deploy/k8s/41-immo-mcp-ingress.yaml packages/immo-mcp/config/*.json
  packages/immo-mcp/src/fixtures/*.json)
for path in "${extra[@]}"; do
  [[ -f $path && ! -L $path ]]
  tar -rf "$RUN_DIR/source.tar" "$path"
  printf '%s\n' "$path" >> "$LOG_DIR/archived-paths.txt"
done
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
git rev-parse HEAD > "$LOG_DIR/head.txt"
printf '%s\n' "$SCOPE" > "$LOG_DIR/scope.txt"
cleanup_pwe() {
  local status=$?
  trap - EXIT INT TERM
  [[ -z ${RUN_PID:-} ]] || { kill "$RUN_PID" 2>/dev/null || true; wait "$RUN_PID" 2>/dev/null || true; }
  "${compose[@]}" logs --no-color > "$LOG_DIR/compose.log" 2>&1 || true
  "${compose[@]}" ps -a > "$LOG_DIR/compose-state.log" 2>&1 || true
  guarded_down > "$LOG_DIR/cleanup.log" 2>&1 || status=1
  flock -u 8
  printf 'Shared campaign lock released\n' > "$LOG_DIR/lock-release.txt"
  printf '%s\n' "$status" > "$LOG_DIR/status"
  exit "$status"
}
verify_ownership
trap cleanup_pwe EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
printf '%s\n' "$LOG_DIR" | tee "$ROOT/tmp/pwe-evidence/latest"
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" run --rm --no-deps -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-pwe-container.sh "$1" "$2"' \
  -- "${PHASE:-pg}" "$SCOPE" > >(tee "$LOG_DIR/campaign.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
