#!/usr/bin/env bash
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-artefacts-dlv && $API_PORT == 18927 && $UI_PORT == 15927 && $MAILDEV_UI_PORT == 11927 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
TASK_DIR=$ROOT/tmp/delivery-evidence
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$
mkdir -p "$RUN_DIR" "$LOG_DIR"
echo "Evidence: $LOG_DIR"
if [[ -d $TASK_DIR/manifests ]]; then cp -r "$TASK_DIR/manifests" "$LOG_DIR/"; fi
exec 8>"$HOME/.cache/radar-docker-campaign.lock"
until flock -w 30 8; do echo 'WAIT: Docker campaign lock'; done
while [[ -n $(docker ps --filter name=radar-test- --format '{{.Names}}') ]]; do
  echo 'WAIT: foreign radar-test campaign'; sleep 30
done
[[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 8388608 ]]
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source tools/make/base-api-resources.sh
source tools/make/base-api-compose.sh
ACTION=test-api
write_compose
git ls-files --cached --others --exclude-standard -- api packages ui tools deploy radar/ontology \
  package.json package-lock.json tsconfig.base.json eslint.config.js .security > "$RUN_DIR/candidates"
: > "$RUN_DIR/paths"
while IFS= read -r path; do
  case /$path/ in */.env*|*/node_modules/*|*/dist/*|*/input/*|*/credentials*|*/secrets*) continue;; esac
  [[ -f $path && ! -L $path ]] || continue
  printf '%s\n' "$path" >> "$RUN_DIR/paths"
done < "$RUN_DIR/candidates"
tar --verbatim-files-from --no-recursion -cf "$RUN_DIR/source.tar" -T "$RUN_DIR/paths"
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
git rev-parse HEAD > "$LOG_DIR/candidate-sha.txt"
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
(
  while sleep 2; do
    foreign=$(docker ps --filter name=radar-test- --format '{{.Names}}' |
      awk -v project="$PROJECT" 'index($0, project "-") != 1 && index($0, project "_") != 1')
    if [[ -n $foreign || $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -lt 8388608 ]]; then
      echo 'STOP: foreign test campaign or low disk' > "$LOG_DIR/occupancy-stop.log"
      kill -TERM "$$"; exit
    fi
  done
) 8>&- > "$LOG_DIR/monitor.log" 2>&1 &
MONITOR=$!
"${compose[@]}" up -d --wait postgres minio
printf '%s\n' "$CMD" > "$LOG_DIR/command.txt"
"${compose[@]}" run --rm --no-deps -T -e DELIVERY_COMMAND="$CMD" api bash -euc \
  'tar --no-same-owner -xf /source.tar -C /workspace; chmod 755 /workspace; timeout --signal=TERM --kill-after=10 1800 bash -euc "$DELIVERY_COMMAND"' \
  > >(tee "$LOG_DIR/run.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
echo PASS > "$LOG_DIR/result"
