#!/usr/bin/env bash
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-api-paniers-pwe || $ENV == e2e-api-paniers-pwe ]]
[[ $API_PORT == 18935 && $UI_PORT == 15935 && $MAILDEV_UI_PORT == 11935 ]]
[[ ${PHASE:-pg} =~ ^(pg|full|api|mutations|inherited|targeted|proxy)$ ]]
ROOT=$(pwd -P)
git diff --quiet HEAD
if [[ -z ${SCOPE:-} ]]; then
  SCOPE=$(git ls-files -- 'api/src/artifacts/write-*.test.ts' \
    'api/src/services/facets/pw-write-*.test.ts' 'api/src/services/facets/signal-write-*.test.ts' \
    'api/tests/integration/pw-write*.spec.ts' 'api/tests/integration/pwe-*.spec.ts' \
    'api/tests/integration/pwcr-*.spec.ts' \
    'api/src/artifacts/published-write*.test.ts' 'api/tests/integration/l5-*.spec.ts' \
    'api/tests/integration/artifacts-baskets.spec.ts' 'api/tests/integration/artifacts-reader-opening.spec.ts' | sed 's#^api/##')
fi
if [[ ${PHASE:-pg} == proxy ]]; then
  [[ $SCOPE == tests/integration/pwcr-proxy.acceptance.ts && -f api/$SCOPE ]]
else require_scope; fi
PROJECT=radar-$ENV
ACTION=ci-api
RUN_DIR=$ROOT/tmp/l5-evidence/runtime
LOG_DIR=$ROOT/tmp/l5-evidence/$(date -u +%Y%m%dT%H%M%S)-${PHASE:-pg}
mkdir -p "$RUN_DIR" "$LOG_DIR"
source tools/make/base-api-l5-lock.sh
acquire_l5_lock
git diff --quiet HEAD
SOURCE_HEAD=$(git rev-parse HEAD)
FIRST_TRACK=$(git rev-parse 'approved/main^1')
git merge-base --is-ancestor "$FIRST_TRACK" HEAD
FIRST_COUNT=$(git show "$FIRST_TRACK:api/drizzle/meta/_journal.json" | jq -er '.entries|length')
cmp <(git show "$FIRST_TRACK:api/drizzle/meta/_journal.json" | jq -c '.entries') \
  <(jq -c --argjson count "$FIRST_COUNT" '.entries[:$count]' api/drizzle/meta/_journal.json)
mapfile -t first_sql < <(git show "$FIRST_TRACK:api/drizzle/meta/_journal.json" | jq -r '.entries[].tag| "api/drizzle/"+. +".sql"')
git diff --quiet "$FIRST_TRACK" HEAD -- "${first_sql[@]}"
jq -n --arg head "$FIRST_TRACK" --argjson count "$FIRST_COUNT" '{head:$head,count:$count}' > "$LOG_DIR/first-track.json"
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
if [[ ${PHASE:-pg} == proxy ]]; then
  source tools/make/base-api-pwc-review-proxy.sh
  write_review_proxy_compose
fi
source tools/make/base-api-pwa-offline.sh
archive_sources
archive_ci_inputs
extra=(tools/make/base-api-pwe-before-app-result.txt ui/package.json
  ui/nginx/default.conf deploy/k8s/nginx/default.conf
  deploy/overlays/preprod/nginx/default.conf deploy/overlays/preprod/kustomization.yaml
  api/tests/*.ts api/src/scripts/base-preprod-rights.json tools/h4-mcp.mk
  tools/make/artefacts-delivery-account.sql tools/make/artefacts-delivery-probe.sh
  deploy/k8s/immo-mcp/41-immo-mcp-ingress.yaml packages/immo-mcp/config/*.json
  packages/immo-mcp/src/fixtures/*.json)
for path in "${extra[@]}"; do
  [[ -f $path && ! -L $path ]]
  tar -rf "$RUN_DIR/source.tar" "$path"
  printf '%s\n' "$path" >> "$LOG_DIR/archived-paths.txt"
done
[[ $(git rev-parse HEAD) == "$SOURCE_HEAD" ]]
git diff --quiet HEAD
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
printf '%s\n' "$SOURCE_HEAD" > "$LOG_DIR/head.txt"
printf '%s\n' "$SCOPE" > "$LOG_DIR/scope.txt"
cleanup_pwe() {
  local status=$?
  trap - EXIT INT TERM
  [[ -z ${RUN_PID:-} ]] || { kill "$RUN_PID" 2>/dev/null || true; wait "$RUN_PID" 2>/dev/null || true; }
  [[ -z ${MONITOR_PID:-} ]] || { kill "$MONITOR_PID" 2>/dev/null || true; wait "$MONITOR_PID" 2>/dev/null || true; }
  [[ -z ${PROXY_PID:-} ]] || { kill "$PROXY_PID" 2>/dev/null || true; wait "$PROXY_PID" 2>/dev/null || true; }
  "${compose[@]}" logs --no-color > "$LOG_DIR/compose.log" 2>&1 || true
  "${compose[@]}" ps -a > "$LOG_DIR/compose-state.log" 2>&1 || true
  guarded_down > "$LOG_DIR/cleanup.log" 2>&1 || status=1
  release_l5_lock
  printf 'Shared campaign lock released\n' > "$LOG_DIR/lock-release.txt"
  printf '%s\n' "$status" > "$LOG_DIR/status"
  exit "$status"
}
verify_ownership
trap cleanup_pwe EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
docker ps --format '{{.Names}}' > "$LOG_DIR/occupancy-start.txt"
(
  while sleep 1; do
    if ! foreign=$(docker ps --format '{{.Names}} {{.Label "org.radar.base.owner"}}' |
      awk -v owner="$OWNER" '$2 != owner {print $1}'); then
      echo 'Docker occupancy could not be verified' > "$LOG_DIR/occupancy-stop.txt"
      kill -TERM "$$"; exit
    fi
    if [[ -n $foreign ]]; then
      printf 'Foreign stack appeared during the owned campaign\n%s\n' "$foreign" > "$LOG_DIR/occupancy-stop.txt"
      kill -TERM "$$"; exit
    fi
  done
) 7>&- 8>&- > "$LOG_DIR/occupancy-monitor.log" 2>&1 &
MONITOR_PID=$!
printf '%s\n' "$LOG_DIR" | tee "$ROOT/tmp/l5-evidence/latest"
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" run --rm --no-deps --use-aliases -T api bash -ec \
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-l5-container.sh "$1" "$2" "$3"' \
  -- "${PHASE:-pg}" "$SCOPE" "${MUTANTS:-}" > >(tee "$LOG_DIR/campaign.log") 2>&1 &
RUN_PID=$!
if [[ ${PHASE:-pg} == proxy ]]; then
  (
    while [[ ! -f $LOG_DIR/proxy-ready ]]; do kill -0 "$RUN_PID" || exit 1; sleep 1; done
    "${compose[@]}" up -d --wait proxy-compose proxy-cluster proxy-preprod
  ) 7>&- 8>&- > "$LOG_DIR/proxy-start.log" 2>&1 &
  PROXY_PID=$!
fi
wait "$RUN_PID"
RUN_PID=
[[ -z ${PROXY_PID:-} ]] || { wait "$PROXY_PID"; PROXY_PID=; }
