#!/usr/bin/env bash
set -euo pipefail
[[ $ENV == test-artefacts-ouv-l3 && $API_PORT == 18935 && $UI_PORT == 15935 && $MAILDEV_UI_PORT == 11935 ]]
ROOT=$(pwd -P)
PROJECT=radar-$ENV
OWNER=$(printf '%s' "$ROOT/$ENV" | sha256sum | cut -d' ' -f1)
TASK_DIR=$ROOT/tmp/sol-l3-evidence
RUN_DIR=$TASK_DIR/runtime
LOG_DIR=$TASK_DIR/$(date -u +%Y%m%dT%H%M%S)-$$
mkdir -p "$RUN_DIR" "$LOG_DIR"
printf 'Evidence: %s\n' "$LOG_DIR"
exec 8>"$HOME/.cache/radar-docker-campaign.lock"
until flock -w 10 8; do echo 'WAIT: shared Docker campaign lock'; done
foreign_tests() {
  docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}}' |
    awk '$2 ~ /^(radar-)?(test-|e2e-)/ {print}'
}
while [[ -n $(foreign_tests) ]]; do echo 'WAIT: foreign test stack'; sleep 10; done
[[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 8388608 ]]
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
compose=(docker compose --env-file /dev/null -p "$PROJECT" -f "$RUN_DIR/compose.yml")
source tools/make/base-api-resources.sh
source tools/make/base-api-compose.sh
source tools/make/base-api-guards.sh
ACTION=test-api
write_compose
git --git-dir=tmp/sol-l3.git --work-tree=. ls-files --cached --others --exclude-standard -- \
  api packages ui tools deploy radar/ontology package.json package-lock.json \
  tsconfig.base.json eslint.config.js .security > "$RUN_DIR/candidates"
: > "$RUN_DIR/paths"
while IFS= read -r path; do
  case /$path/ in */.env*|*/node_modules/*|*/dist/*|*/input/*|*/credentials*|*/secrets*) continue;; esac
  [[ -f $path && ! -L $path ]] || continue
  printf '%s\n' "$path" >> "$RUN_DIR/paths"
done < "$RUN_DIR/candidates"
tar --verbatim-files-from --no-recursion -cf "$RUN_DIR/source.tar" -T "$RUN_DIR/paths"
sha256sum "$RUN_DIR/source.tar" > "$LOG_DIR/source.sha256"
git --git-dir=tmp/sol-l3.git rev-parse HEAD > "$LOG_DIR/candidate-sha.txt"
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
"${compose[@]}" up -d --wait postgres minio
printf '%s\n' "$CMD" > "$LOG_DIR/command.txt"
"${compose[@]}" run --rm --no-deps -T -e L3_COMMAND="$CMD" api bash -euc \
  'tar --no-same-owner -xf /source.tar -C /workspace; chmod 755 /workspace; npm ci --ignore-scripts --no-audit --no-fund > /evidence/install.log 2>&1; node node_modules/esbuild/install.js >> /evidence/install.log 2>&1; exec bash -euc "$L3_COMMAND"' \
  > >(tee "$LOG_DIR/run.log") 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=
echo PASS > "$LOG_DIR/result"
