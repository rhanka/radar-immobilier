#!/usr/bin/env bash
# Reuse BASE archive, ownership and cleanup guards without weakening them.
set -euo pipefail
mode=${1:?}
case $mode in test|check|mutations|e2e|image|qualify) ;; *) exit 2;; esac
source tools/make/base-api-guards.sh
require_env
require_scope
[[ $ENV == test-a2base-rest && $API_PORT == 18926 && $UI_PORT == 15926 && $MAILDEV_UI_PORT == 11926 ]]
[[ -n ${MCP_SCOPE:-} ]]
for path in $MCP_SCOPE; do
  [[ $path =~ ^src/[a-zA-Z0-9_./-]+\.test\.ts$ && $path != *..* && -f packages/immo-mcp/$path ]] || exit 2
done
ROOT=$(pwd -P)
PROJECT=radar-$ENV
TASK_DIR=$ROOT/tmp/a2base-rest-evidence/$ENV
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$-$mode
mkdir -p "$RUN_DIR" "$LOG_DIR"
printf 'Evidence: %s\n' "$LOG_DIR"
printf '%s\n' "$SCOPE" > "$LOG_DIR/api-scope.txt"
printf '%s\n' "$MCP_SCOPE" > "$LOG_DIR/mcp-scope.txt"
# Queue for the campaign before waiting for containers; never touch another stack.
exec 9>"$RUN_DIR/lock"
flock -n 9 || exit 2
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
until flock -w 60 8; do
  printf '%s WAIT global campaign reservation\n' "$(date -u +%FT%TZ)" | tee -a "$LOG_DIR/wait.log"
done
while :; do
  names=$(docker ps --format '{{.Names}}')
  builds=$(pgrep -af '(^|/)(docker (build|buildx build)|docker-buildx build)( |$)' || true)
  free=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
  if [[ -z $names && -z $builds && $free -ge 10485760 ]]; then break; fi
  printf '%s WAIT containers=%s builds=%s freeKiB=%s\n' "$(date -u +%FT%TZ)" "$names" "$builds" "$free" | tee -a "$LOG_DIR/wait.log"
  sleep 60
done
git --git-dir="$ROOT/tmp/a2base-rest-delivery.git" rev-parse HEAD > "$LOG_DIR/candidate-sha.txt"
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
    tmpfs: ["/tmp:size=1024m,exec"]
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
  'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-a2rest-container.sh "$@"' -- "$mode" "$SCOPE" "$MCP_SCOPE" \
  > >(tee "$LOG_DIR/$mode.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
if [[ $mode == image || $mode == qualify ]]; then
  context=$LOG_DIR/image-context
  mkdir -p "$context"
  mv "$LOG_DIR/runtime.tar" "$context/runtime.tar"
  cp tools/make/base-api-a2rest-image.Dockerfile "$context/Dockerfile"
  candidate=$(cat "$LOG_DIR/candidate-sha.txt")
  image=radar-a2base-rest:${candidate:0:12}
  export BUILDX_CONFIG=$TASK_DIR/buildx
  mkdir -p "$BUILDX_CONFIG"
  # The owned dependency stack stays up; every other stack/build must be absent.
  [[ -z $(docker ps --filter "label=com.docker.compose.project!=$PROJECT" --format '{{.Names}}') ]]
  [[ -z $(pgrep -af '(^|/)(docker (build|buildx build)|docker-buildx build)( |$)' || true) ]]
  docker build --network=none --build-arg CANDIDATE_SHA="$candidate" -t "$image" "$context" > "$LOG_DIR/image-build.log" 2>&1
  docker image inspect --format '{{.Id}} {{json .RepoDigests}} {{index .Config.Labels "org.radar.a2base.candidate"}}' \
    "$image" > "$LOG_DIR/image-identity.txt"
  image_evidence=$LOG_DIR/image-runtime
  mkdir -p "$image_evidence"
  docker run --rm --name "$PROJECT-image-proof" --network "${PROJECT}_default" --memory 4g \
    --label "com.docker.compose.project=$PROJECT" --label "org.radar.base.owner=$OWNER" \
    --label com.docker.compose.service=api --label com.docker.compose.oneoff=True \
    -e NODE_ENV=test -e LOG_LEVEL=silent -e LOT_MIGRATION_DB_TEST=1 \
    -e POSTGRES_HOST=postgres -e POSTGRES_USER=radar -e POSTGRES_PASSWORD=synthetic-only -e POSTGRES_DB=radar \
    -e S3_ACCESS_KEY=synthetic -e S3_SECRET_KEY=synthetic -e S3_ENDPOINT=http://minio:9000 \
    -e DOTENV_CONFIG_PATH=/dev/null -v "$image_evidence:/evidence" "$image" > "$LOG_DIR/image-run.log" 2>&1 &
  RUN_PID=$!
  wait "$RUN_PID"
  RUN_PID=
  SCOPE=tests/integration/mcp-signal-search-network.e2e.spec.ts assert_tests_ran "$image_evidence/image-tests.tsv"
  awk -F '\t' '$2 == 11 && $3 == 0 && $4 == 0 {ok=1} END {exit !ok}' "$image_evidence/image-tests.tsv"
  rm "$context/runtime.tar"
fi
[[ $mode == check ]] || assert_tests_ran "$LOG_DIR/tests.tsv"
if [[ $mode == e2e ]]; then
  [[ $SCOPE == tests/integration/mcp-signal-search-network.e2e.spec.ts ]]
  awk -F '\t' '$2 == 11 && $3 == 0 && $4 == 0 {ok=1} END {exit !ok}' "$LOG_DIR/tests.tsv"
fi
if [[ $mode != check ]]; then
  SCOPE=$MCP_SCOPE assert_tests_ran "$LOG_DIR/mcp-tests.tsv"
fi
printf 'PASS %s\n' "$mode" > "$LOG_DIR/result"
