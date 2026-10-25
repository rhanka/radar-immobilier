#!/usr/bin/env bash
set -euo pipefail
source tools/make/base-api-guards.sh
require_env
[[ $ENV == test-artefacts-a4 && $API_PORT == 18923 && $UI_PORT == 15923 && $MAILDEV_UI_PORT == 11923 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
TASK_DIR=$ROOT/tmp/a4-evidence
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$
mkdir -p "$RUN_DIR" "$LOG_DIR"
echo "Evidence: $LOG_DIR"
while :; do
  names=$(docker ps --filter name=radar-test- --format '{{.Names}}')
  [[ -n $names ]] || break
  echo "WAIT: $names"
  sleep 60
done
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
flock -n 8 || { echo 'Machine Docker campaign lock held'; exit 2; }
[[ -z $(docker ps --filter name=radar-test- -q) ]]
[[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 8388608 ]]
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source tools/make/base-api-resources.sh
source tools/make/base-api-compose.sh
ACTION=test-api
write_compose
# A bounded source archive prevents any environment discovery in the container.
git ls-files --cached --others --exclude-standard -- api packages ui tools radar/ontology \
  package.json package-lock.json tsconfig.base.json eslint.config.js > "$RUN_DIR/candidates"
: > "$RUN_DIR/paths"
while IFS= read -r path; do
  case /$path/ in */.env*|*/node_modules/*|*/dist/*|*/input/*|*/credentials*|*/secrets*) continue;; esac
  [[ -f $path && ! -L $path ]] || continue
  printf '%s\n' "$path" >> "$RUN_DIR/paths"
done < "$RUN_DIR/candidates"
tar --verbatim-files-from --no-recursion -cf "$RUN_DIR/source.tar" -T "$RUN_DIR/paths"
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
mkdir -p "$HOME/.cache/radar-a4-npm"
cat > "$RUN_DIR/cache.yml" <<YAML
services:
  api:
    volumes:
      - $HOME/.cache/radar-a4-npm:/npm-cache
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
  while sleep 10; do
    if [[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -lt 8388608 ]]; then
      echo 'STOP: less than 8 GiB free' > "$LOG_DIR/disk-stop.log"
      kill -TERM "$$"; exit
    fi
  done
) 8>&- > "$LOG_DIR/disk-monitor.log" 2>&1 &
MONITOR=$!
if [[ ${A4_SERVICES:-0} == 1 ]]; then "${compose[@]}" up -d --wait postgres minio; fi
printf '%s\n' "$CMD" > "$LOG_DIR/command.txt"
"${compose[@]}" run --rm --no-deps -T -e A4_COMMAND="$CMD" api bash -euc \
  'tar --no-same-owner -xf /source.tar -C /workspace; chmod 755 /workspace; timeout --signal=TERM --kill-after=10 1800 bash -euc "$A4_COMMAND"' \
  > >(tee "$LOG_DIR/run.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
if [[ ${A4_COPY_LOCK:-0} == 1 ]]; then cp "$LOG_DIR/package-lock.json" "$ROOT/package-lock.json"; fi
echo PASS > "$LOG_DIR/result"
