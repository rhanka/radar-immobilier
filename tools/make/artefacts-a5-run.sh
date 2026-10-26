#!/usr/bin/env bash
set -euo pipefail
if [[ ${A5_FROZEN_RUNNER:-} != 1 ]]; then
  mkdir -p tmp/a5-evidence
  snapshot=$(mktemp "$PWD/tmp/a5-evidence/runner.XXXXXX")
  cp "$0" "$snapshot"
  export A5_FROZEN_RUNNER=1
  exec bash "$snapshot"
fi
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-artefacts-a5m && $API_PORT == 18925 && $UI_PORT == 15925 && $MAILDEV_UI_PORT == 11925 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
TASK_DIR=$ROOT/tmp/a5-evidence
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$
mkdir -p "$RUN_DIR" "$LOG_DIR"
echo "Evidence: $LOG_DIR"
git --git-dir="$ROOT/tmp/a5-delivery.git" show 4660e201:package-lock.json > "$LOG_DIR/baseline-lock.json"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
until flock -w 60 8; do
  echo 'WAIT: machine Docker campaign lock held'
done
wait_machine() {
  while :; do
    names=$(docker ps --format '{{.Names}}' | awk '/^radar-test-|^test-e2-int-qualification-/')
    builds=$(pgrep -af '^docker (build|buildx build)|^/.*docker-buildx build' || true)
    [[ -n $names || -n $builds ]] || return 0
    echo "WAIT: $names $builds"
    sleep 60
  done
}
wait_machine
[[ -z $(docker ps --format '{{.Names}}' | awk '/^radar-test-|^test-e2-int-qualification-/') ]]
[[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 8388608 ]]
[[ $(awk '/MemAvailable/ {print $2}' /proc/meminfo) -ge 8388608 ]]
candidate_git=(git)
if [[ -f $ROOT/tmp/a5-delivery.git/config ]]; then candidate_git+=(--git-dir="$ROOT/tmp/a5-delivery.git"); fi
candidate=$("${candidate_git[@]}" rev-parse HEAD)
"${candidate_git[@]}" show 5ea88ce1:api/drizzle/meta/_journal.json > "$LOG_DIR/baseline-journal.json"
while IFS= read -r path; do
  [[ $path != api/drizzle/meta/_journal.json ]] || continue
  digest=$("${candidate_git[@]}" show "5ea88ce1:$path" | sha256sum | cut -d' ' -f1)
  printf '%s  %s\n' "$digest" "$path"
done < <("${candidate_git[@]}" ls-tree -r --name-only 5ea88ce1 -- api/drizzle) > "$LOG_DIR/baseline-migrations.sha256"
printf '%s\n' "$candidate" > "$LOG_DIR/candidate-sha.txt"
"${candidate_git[@]}" status --porcelain --untracked-files=all -- api packages tools .security \
  package.json package-lock.json tsconfig.base.json eslint.config.js > "$LOG_DIR/candidate-status.txt"
if [[ ${A5_IMAGE:-0} == 1 && -s $LOG_DIR/candidate-status.txt ]]; then
  echo 'Runtime proof requires committed source bytes' >&2; exit 2
fi
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
mkdir -p "$HOME/.cache/radar-a5-docker"
export DOCKER_CONFIG=$HOME/.cache/radar-a5-docker
if [[ -d $HOME/.docker/cli-plugins && ! -e $DOCKER_CONFIG/cli-plugins && ! -L $DOCKER_CONFIG/cli-plugins ]]; then
  ln -s "$HOME/.docker/cli-plugins" "$DOCKER_CONFIG/cli-plugins"
fi
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source tools/make/base-api-resources.sh
# Interrupted --rm clients can release their volume just after compose down.
# Keep the shared ownership checks and wait for that observable settlement.
cleanup() {
  local status=$? settled=0 attempt
  trap - EXIT INT TERM
  [[ -z ${RUN_PID:-} ]] || { kill "$RUN_PID" 2>/dev/null || true; wait "$RUN_PID" 2>/dev/null || true; }
  [[ -z ${MONITOR:-} ]] || { kill "$MONITOR" 2>/dev/null || true; wait "$MONITOR" 2>/dev/null || true; }
  "${compose[@]}" logs --no-color > "$LOG_DIR/compose.log" 2>&1 || true
  "${compose[@]}" ps -a > "$LOG_DIR/compose-state.log" 2>&1 || true
  : > "$LOG_DIR/cleanup.log"
  for attempt in 1 2 3 4 5; do
    if guarded_down >> "$LOG_DIR/cleanup.log" 2>&1; then settled=1; break; fi
    sleep 1
  done
  if [[ $settled != 1 ]]; then
    echo 'Cleanup failed after bounded owned-resource settlement retries' | tee "$LOG_DIR/residuals.log" >&2
    [[ $status != 0 ]] || status=1
    rm -f "$LOG_DIR/result"
  fi
  printf '%s\n' "$status" > "$LOG_DIR/status"
  exit "$status"
}
source tools/make/base-api-compose.sh
ACTION=test-api
write_compose
# A bounded source archive prevents any environment discovery in the container.
git ls-files --cached --others --exclude-standard -- api packages ui tools radar/ontology \
  package.json package-lock.json tsconfig.base.json eslint.config.js \
  deploy/k8s/41-immo-mcp-ingress.yaml deploy/k8s/scrape/run-chunks.sh .security > "$RUN_DIR/candidates"
: > "$RUN_DIR/paths"
while IFS= read -r path; do
  case /$path/ in */.env*|*/node_modules/*|*/dist/*|*/input/*|*/credentials*|*/secrets*) continue;; esac
  [[ -f $path && ! -L $path ]] || continue
  printf '%s\n' "$path" >> "$RUN_DIR/paths"
done < "$RUN_DIR/candidates"
tar --verbatim-files-from --no-recursion -cf "$RUN_DIR/source.tar" -T "$RUN_DIR/paths"
cp --reflink=auto "$RUN_DIR/source.tar" "$LOG_DIR/source.tar"
sha256sum "$LOG_DIR/source.tar" > "$LOG_DIR/source.sha256"
mkdir -p "$HOME/.cache/radar-a5-npm"
cat > "$RUN_DIR/cache.yml" <<YAML
services:
  api:
    volumes:
      - $HOME/.cache/radar-a5-npm:/npm-cache
    environment:
      npm_config_cache: /npm-cache
YAML
compose+=(-f "$RUN_DIR/cache.yml")
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
wait_machine
(
  while sleep 1; do
    foreign=$(docker ps --format '{{.Names}}' |
      awk -v project="$PROJECT" '/^radar-test-|^test-e2-int-qualification-/ && index($0, project "-") != 1 && index($0, project "_") != 1')
    if [[ -n $foreign ]]; then
      printf 'STOP: foreign test campaign started\n%s\n' "$foreign" > "$LOG_DIR/occupancy-stop.log"
      kill -TERM "$$"; exit
    fi
    if [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -lt 8388608 ]]; then
      echo 'STOP: less than 8 GiB free' > "$LOG_DIR/disk-stop.log"
      kill -TERM "$$"; exit
    fi
    if [[ $(awk '/MemAvailable/ {print $2}' /proc/meminfo) -lt 8388608 ]]; then
      echo 'STOP: less than 8 GiB memory available' > "$LOG_DIR/memory-stop.log"
      kill -TERM "$$"; exit
    fi
  done
) 8>&- > "$LOG_DIR/disk-monitor.log" 2>&1 &
MONITOR=$!
if [[ ${A5_IMAGE:-0} == 1 ]]; then
  image=${A5_EXISTING_IMAGE:-$PROJECT:runtime}
  if [[ ${A5_BUILD_IMAGE:-0} == 1 ]]; then
    timeout --signal=TERM --kill-after=10 1800 docker build --target runtime --build-arg "GIT_SHA=$candidate" \
      -t "$image" -f api/Dockerfile - < "$RUN_DIR/source.tar" > >(tee "$LOG_DIR/build.log") 2>&1 &
    RUN_PID=$!
    wait "$RUN_PID"
    RUN_PID=
  else
    [[ -n ${A5_EXISTING_IMAGE:-} ]] || { echo 'Existing runtime image required; no build authorized' >&2; exit 2; }
  fi
  docker image inspect --format '{{.Id}}' "$image" > "$LOG_DIR/image-id.txt"
fi
if [[ ${A5_SERVICES:-0} == 1 ]]; then "${compose[@]}" up -d --wait postgres minio; fi
printf '%s\n' "$CMD" > "$LOG_DIR/command.txt"
if [[ ${A5_IMAGE:-0} == 1 ]]; then
  chmod 777 "$LOG_DIR"
  timeout --signal=TERM --kill-after=10 180 docker run --pull=never --rm --name "$PROJECT-image-probe" --network "${PROJECT}_default" \
    --label "com.docker.compose.project=$PROJECT" --label "org.radar.base.owner=$OWNER" \
    -v "$ROOT/tools/make/artefacts-a5-image-client.mjs:/workspace/a5-image-client.mjs:ro" \
    -v "$ROOT/tools/make/artefacts-a5-image-probe.mjs:/workspace/a5-image-probe.mjs:ro" \
    -v "$LOG_DIR:/evidence" --entrypoint node "$image" a5-image-probe.mjs \
    > >(tee "$LOG_DIR/run.log") 2>&1 &
else
"${compose[@]}" run --rm --no-deps -T -e A5_COMMAND="$CMD" api bash -euc \
  'tar --no-same-owner -xf /source.tar -C /workspace; chmod 755 /workspace; timeout --signal=TERM --kill-after=10 1800 bash -euc "$A5_COMMAND"' \
  > >(tee "$LOG_DIR/run.log") 2>&1 &
fi
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
if [[ ${A5_COPY_LOCK:-0} == 1 ]]; then cp "$LOG_DIR/package-lock.json" "$ROOT/package-lock.json"; fi
echo PASS > "$LOG_DIR/result"
