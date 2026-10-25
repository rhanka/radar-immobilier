#!/usr/bin/env bash
# One machine-wide campaign, no root Makefile, host runtime or environment discovery.
set -euo pipefail
action=${1:-}
[[ ${ENV:-} == test-base-preprod && ${API_PORT:-} == 18925 && ${UI_PORT:-} == 15925 && ${MAILDEV_UI_PORT:-} == 11925 ]]
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROFILES
ROOT=$(pwd -P)
TASK_DIR=$ROOT/tmp/base-preprod-evidence
export BUILDX_CONFIG=$TASK_DIR/buildx-cache
mkdir -p "$BUILDX_CONFIG"
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$action
mkdir -p "$RUN_DIR" "$LOG_DIR"
echo "Evidence: $LOG_DIR"
git rev-parse HEAD > "$LOG_DIR/source-commit.txt"
git diff HEAD --no-ext-diff | sha256sum > "$LOG_DIR/source-diff.sha256"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
while ! flock -w 30 8; do
  printf 'Waiting for the machine-wide Docker campaign lock\n' | tee -a "$LOG_DIR/campaign-wait.log"
done
while :; do
  busy=$(docker ps --format '{{.Names}}' | awk '/^radar-test-/')
  builds=$(pgrep -f '(^|/)[d]ocker (build|buildx build)|[d]ocker-buildx (build|buildx build|bake)|[b]uildctl build' || true)
  if [[ -z $busy && -z $builds ]]; then break; fi
  printf 'Waiting 10s: Docker campaign busy\n%s\n%s\n' "$busy" "$builds" | tee -a "$LOG_DIR/campaign-wait.log"
  sleep 10
done
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 8388608 ]] || { echo 'STOP: below 8 GiB free'; exit 3; }
PROJECT=radar-$ENV
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
TOOLS=$ROOT/tools/make
source "$TOOLS/base-api-guards.sh"
source "$TOOLS/base-api-resources.sh"
source "$TOOLS/base-api-ci-archive.sh"
archive_sources
archive_ci_inputs
git ls-files --cached --others --exclude-standard -- tools/make/base-preprod* deploy/base-preprod api/src/scripts/base-preprod*.json api/Dockerfile api/docker-entrypoint.sh > "$RUN_DIR/operator-paths"
git ls-files --cached -- ui api/tests tools/security .security/vulnerability-register.yaml >> "$RUN_DIR/operator-paths"
while IFS= read -r path; do [[ ! -L $path && $path != *..* && $path != *.env* ]]; done < "$RUN_DIR/operator-paths"
tar --verbatim-files-from --no-recursion -rf "$RUN_DIR/source.tar" -T "$RUN_DIR/operator-paths"
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
verify_ownership
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
(
  while sleep 10; do
    if [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -lt 8388608 ]]; then
      echo 'STOP: below 8 GiB free' > "$LOG_DIR/disk-stop.log"; kill -TERM "$$"; exit
    fi
  done
) 8>&- > "$LOG_DIR/disk-monitor.log" 2>&1 &
MONITOR=$!
case $action in
verify)
  ACTION=ci-api
  source "$TOOLS/base-api-compose.sh"
  write_compose
  guarded_down
  "${compose[@]}" up -d --wait postgres minio
  "${compose[@]}" run --rm --no-deps -T api bash -ec \
    'tar -xf /source.tar -C /workspace; exec bash tools/make/base-preprod-quality.sh' \
    > >(tee "$LOG_DIR/verify.log") 2>&1 &
  RUN_PID=$!; wait "$RUN_PID"; RUN_PID=;;
build-image)
  source "$TOOLS/base-preprod-image-compose.sh"
  image_compose
  guarded_down
  docker build --build-arg "GIT_SHA=$(git rev-parse HEAD)" -f api/Dockerfile -t radar-base-preprod-p1o1:qualified - < "$RUN_DIR/source.tar" > "$LOG_DIR/build.log" 2>&1 &
  RUN_PID=$!; wait "$RUN_PID"; RUN_PID=
  docker image inspect --format '{{.Id}}' radar-base-preprod-p1o1:qualified > "$LOG_DIR/image-id.txt"
  OPERATOR_LOCAL_IMAGE=local/synthetic-api@$(cat "$LOG_DIR/image-id.txt")
  image_compose
  guarded_down
  "${compose[@]}" up -d --wait postgres
  "${compose[@]}" run --rm --no-deps -T api > >(tee "$LOG_DIR/image-proof.log") 2>&1 &
  RUN_PID=$!; wait "$RUN_PID"; RUN_PID=;;
*) exit 2;;
esac
echo "PASS $action" > "$LOG_DIR/result"
