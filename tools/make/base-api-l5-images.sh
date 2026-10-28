#!/usr/bin/env bash
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == e2e-api-paniers-pwe && $API_PORT == 18935 && $UI_PORT == 15935 && $MAILDEV_UI_PORT == 11935 ]]
ROOT=$(pwd -P)
git diff --quiet HEAD
CANDIDATE=$(git rev-parse HEAD)
PROJECT=radar-$ENV
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
RUN_DIR=$ROOT/tmp/l5-evidence/images-runtime
CAMPAIGN_DIR=$ROOT/tmp/l5-evidence/$(date -u +%Y%m%dT%H%M%S)-images
LOG_DIR=$CAMPAIGN_DIR
mkdir -p "$RUN_DIR" "$LOG_DIR"
echo "Evidence: $CAMPAIGN_DIR"
source tools/make/base-api-l5-lock.sh
acquire_l5_lock
git diff --quiet HEAD
CANDIDATE=$(git rev-parse HEAD)
export COMPOSE_DISABLE_ENV_FILE=1
export DOCKER_CONFIG="$HOME/.cache/radar-l5-docker"
export BUILDX_CONFIG="$DOCKER_CONFIG/buildx"
mkdir -p "$BUILDX_CONFIG"
if [[ -d $HOME/.docker/cli-plugins && ! -e $DOCKER_CONFIG/cli-plugins ]]; then
  ln -s "$HOME/.docker/cli-plugins" "$DOCKER_CONFIG/cli-plugins"
fi
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
ACTION=ci-api
source tools/make/base-api-resources.sh
source tools/make/base-api-compose.sh
source tools/make/base-api-ci-archive.sh
source tools/make/base-api-l5-images-compose.sh
source tools/make/base-api-l5-image-archive.sh
write_compose
cleanup_images() {
  local code=$?
  trap - EXIT INT TERM
  [[ -z ${RUN_PID:-} ]] || { kill "$RUN_PID" 2>/dev/null || true; wait "$RUN_PID" 2>/dev/null || true; }
  [[ -z ${MONITOR:-} ]] || { kill "$MONITOR" 2>/dev/null || true; wait "$MONITOR" 2>/dev/null || true; }
  "${compose[@]}" logs --no-color > "$LOG_DIR/compose.log" 2>&1 || true
  guarded_down > "$LOG_DIR/cleanup.log" 2>&1 || code=1
  release_l5_lock
  printf 'Shared campaign lock released\n' > "$CAMPAIGN_DIR/lock-release.txt"
  printf '%s\n' "$code" > "$CAMPAIGN_DIR/status"
  exit "$code"
}
verify_ownership
trap cleanup_images EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
guarded_down
printf '%s\n' "$CAMPAIGN_DIR" > "$ROOT/tmp/l5-evidence/latest-images"
source tools/make/base-api-pwa-offline.sh
mapfile -t openssl_libraries < <(ldd /usr/bin/openssl |
  awk '/=> \// {print $3} /^[[:space:]]*\/.*ld-linux/ {print $1}' | sort -u)
openssl_inputs=(/usr/bin/openssl "${openssl_libraries[@]}")
tar -C / --dereference -rf "$RUN_DIR/offline-tools.tar" "${openssl_inputs[@]#/}"
sha256sum "${openssl_inputs[@]}" >> "$CAMPAIGN_DIR/offline-system-inputs.sha256"
sha256sum "$RUN_DIR/offline-tools.tar" > "$CAMPAIGN_DIR/offline-tools.sha256"
archive_sources
archive_ci_inputs
image_archive_inputs
[[ $(git rev-parse HEAD) == "$CANDIDATE" ]]
git diff --quiet HEAD
sha256sum "$RUN_DIR/source.tar" > "$CAMPAIGN_DIR/source.sha256"
printf '%s\n' "$CANDIDATE" > "$CAMPAIGN_DIR/head.txt"
(
  while sleep 2; do
    foreign=$(docker ps --format '{{.Names}} {{.Label "org.radar.base.owner"}}' | awk -v owner="$OWNER" '$2!=owner{print $1}') || exit
    if [[ -n $foreign ]]; then printf '%s\n' "$foreign" > "$CAMPAIGN_DIR/foreign-stack.txt"; kill -TERM "$$"; exit; fi
  done
) 7>&- 8>&- &
MONITOR=$!
docker build --target runtime --build-arg "GIT_SHA=$CANDIDATE" -t "$PROJECT:runtime" \
  -f api/Dockerfile - < "$RUN_DIR/source.tar" > "$CAMPAIGN_DIR/image-build.log" 2>&1 || {
    tail -50 "$CAMPAIGN_DIR/image-build.log"; exit 1;
  }
IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$PROJECT:runtime")
printf '%s\n' "$IMAGE_ID" > "$CAMPAIGN_DIR/image-id.txt"
mkdir -p "$RUN_DIR/tls"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=preprod.immo.sent-tech.ca \
  -addext 'subjectAltName=DNS:preprod.immo.sent-tech.ca,DNS:preprod.auth.sent-tech.ca,DNS:*.pinned.pages.sent-tech.ca,DNS:*.pinned.pages.reader.test' \
  -keyout "$RUN_DIR/tls/key.pem" -out "$RUN_DIR/tls/cert.pem" > "$CAMPAIGN_DIR/tls-create.log" 2>&1
CERT_SPKI=$(openssl x509 -in "$RUN_DIR/tls/cert.pem" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)
for CONTENT_BASE in pages.sent-tech.ca pages.reader.test; do
  LOG_DIR=$CAMPAIGN_DIR/$CONTENT_BASE
  mkdir -p "$LOG_DIR"
  compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
  write_compose
  compose+=(-f "$RUN_DIR/offline.yml")
  image_browser_compose
  "${compose[@]}" up -d --wait postgres minio
  "${compose[@]}" run --rm --no-deps --use-aliases -T api bash -ec \
    'tar -xf /source.tar -C /workspace; exec bash tools/make/base-api-l5-images-container.sh' \
    > "$LOG_DIR/browser.log" 2>&1 &
  RUN_PID=$!
  for ((attempt=0; attempt<600; attempt++)); do
    [[ ! -f $LOG_DIR/fixture-ready.json ]] || break
    kill -0 "$RUN_PID" || { tail -60 "$LOG_DIR/browser.log"; wait "$RUN_PID"; exit 1; }
    sleep 1
  done
  [[ -f $LOG_DIR/fixture-ready.json ]]
  image_runtime_compose
  "${compose[@]}" up -d --no-deps runtime runtime-base runtime-read
  for service in runtime runtime-base runtime-read; do
    container=$("${compose[@]}" ps -q "$service")
    docker container inspect --format '{{.Image}}' "$container" > "$LOG_DIR/$service-image-id.txt"
    [[ $(cat "$LOG_DIR/$service-image-id.txt") == "$IMAGE_ID" ]]
    "${compose[@]}" exec -T "$service" cat api/release-sha > "$LOG_DIR/$service-release-sha.txt"
    [[ $(cat "$LOG_DIR/$service-release-sha.txt") == "$CANDIDATE" ]]
  done
  "${compose[@]}" exec -T runtime sh -ec 'sha256sum api/drizzle/*.sql api/drizzle/meta/_journal.json' > "$LOG_DIR/image-migrations.sha256"
  while kill -0 "$RUN_PID" 2>/dev/null; do
    if [[ -f $LOG_DIR/runtime-stop-request ]]; then
      "${compose[@]}" stop runtime runtime-base runtime-read > "$LOG_DIR/runtime-stop.log" 2>&1
      touch "$LOG_DIR/runtime-stopped"
      break
    fi
    sleep 0.2
  done
  wait "$RUN_PID" || { tail -70 "$LOG_DIR/browser.log"; exit 1; }
  RUN_PID=
  expected=5; [[ $CONTENT_BASE != pages.sent-tech.ca ]] || expected=8
  jq -e --argjson expected "$expected" '.numPassedTests==$expected and .numFailedTests==0 and .numPendingTests==0' "$LOG_DIR/browser.json"
  cp "$LOG_DIR/runtime-release-sha.txt" "$LOG_DIR/release-sha.txt"
  [[ $(cat "$LOG_DIR/release-sha.txt") == "$CANDIDATE" ]]
  "${compose[@]}" logs --no-color > "$LOG_DIR/compose.log"
  guarded_down > "$LOG_DIR/cleanup.log" 2>&1
done
