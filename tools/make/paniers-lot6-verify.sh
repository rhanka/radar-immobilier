#!/usr/bin/env bash
set -euo pipefail
case "$ENV" in test-*|e2e-*) ;; *) exit 2;; esac
task_dir="$PWD/tmp/paniers-${LOT,,}"
log_dir="$task_dir/logs/${EVIDENCE_TAG:-$1}"
runtime_dir="$task_dir/runs/$ENV-${EVIDENCE_TAG:-$1}"
mkdir -p "$log_dir" "$task_dir/checkpoints" "$runtime_dir"
export COMPOSE_DISABLE_ENV_FILE=1
export COMPOSE_PROJECT_NAME="radar-$ENV"
export POSTGRES_USER=radar POSTGRES_PASSWORD=synthetic-only POSTGRES_DB=radar
export S3_REGION=test S3_BUCKET=synthetic S3_ACCESS_KEY=synthetic S3_SECRET_KEY=synthetic
export OPENAI_API_KEY= ANTHROPIC_API_KEY= GEMINI_API_KEY= GOOGLE_API_KEY= MISTRAL_API_KEY= COHERE_API_KEY=
cat > "$runtime_dir/compose.yml" <<YAML
services:
  postgres:
    volumes: !reset []
    tmpfs:
      - /var/lib/postgresql/data:size=512m
    environment:
      POSTGRES_INITDB_ARGS: --no-sync
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U radar -d radar"]
      start_period: 180s
  api:
    entrypoint: []
    command: ["sleep", "infinity"]
    volumes: !override
      - $runtime_dir/source.tar:/source.tar:ro
      - $log_dir:/evidence
      - $task_dir/checkpoints:/checkpoints:ro
      - runtime:/workspace
    environment:
      NODE_ENV: test
      LOG_LEVEL: silent
      LOT: '$LOT'
      LOT_MIGRATION_DB_TEST: '1'
volumes:
  runtime:
YAML
compose=(docker compose --env-file /dev/null -p "radar-$ENV" -f docker-compose.yml -f docker-compose.test.yml -f "$runtime_dir/compose.yml")
if [[ "$1" == diagnose ]]; then
  "${compose[@]}" logs --no-color --tail=30 postgres
  exit
fi
if [[ "$1" == clean ]]; then
  "${compose[@]}" down -v --remove-orphans
  exit
fi
if [[ "$1" == inspect ]]; then
  docker ps -a --filter "label=com.docker.compose.project=radar-$ENV" --format '{{.Names}}'
  docker volume ls --filter "label=com.docker.compose.project=radar-$ENV" --format '{{.Name}}'
  docker network ls --filter "label=com.docker.compose.project=radar-$ENV" --format '{{.Name}}'
  exit
fi
cleanup() {
  task_status=$?
  trap - EXIT
  "${compose[@]}" logs --no-color postgres > "$log_dir/postgres.log" 2>&1 || true
  "${compose[@]}" ps -a > "$log_dir/compose-state.log" 2>&1 || true
  "${compose[@]}" down -v --remove-orphans || { [[ $task_status != 0 ]] || task_status=1; }
  exit "$task_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Only source/manifests: environment files, Git metadata and host dependencies
# are excluded before reading file contents. The container sees no host tree.
tar --exclude='.env*' --exclude=node_modules --exclude=dist --exclude=.svelte-kit \
  -cf "$runtime_dir/source.tar" api packages ui tools/make package.json package-lock.json tsconfig.base.json eslint.config.js
case "$1" in verify|test-api) "${compose[@]}" up -d --wait postgres ;; esac
"${compose[@]}" run --rm --no-deps -T api sh -ec '
  tar -xf /source.tar
  npm ci --ignore-scripts --no-audit --no-fund
  cat > /workspace/api/vitest.isolated.config.ts <<'"'"'CONFIG'"'"'
import config from "./vitest.config.js";
export default { ...config, envDir: false, test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };
CONFIG
  case "$1" in
    verify|typecheck) npm run typecheck --workspace=api ;;
    checkpoints)
      for snapshot in /checkpoints/*.tar; do
        number=$(basename "$snapshot" .tar)
        rm -rf api/src api/drizzle
        tar -xf "$snapshot"
        npm run typecheck --workspace=api > "/evidence/checkpoint-$number.log" 2>&1 || {
          cat "/evidence/checkpoint-$number.log"; exit 1;
        }
        grep "^$number|" /checkpoints/manifest | cut -d "|" -f 2 > "/evidence/checkpoint-$number.pass"
        echo "checkpoint-$number: typecheck PASS"
      done
      ;;
  esac
  if [ "$1" = regression ]; then
    cat > /workspace/ui/vitest.isolated.config.ts <<'"'"'CONFIG'"'"'
import config from "./vitest.config.js";
export default { ...config, envDir: false, test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };
CONFIG
    npm run test --workspace=ui -- --config vitest.isolated.config.ts \
      facets 6a-head 6b-version signaux-reglements signal-facets-client SignalFacetControls selection-bucket selection-camera
    cd /workspace/packages/immo-mcp
    ../../node_modules/.bin/vitest run --config /workspace/api/vitest.isolated.config.ts \
      src/data-source.test.ts src/raw-data.test.ts src/server.test.ts
    exit
  fi
  case "$1" in
    verify|lint)
      case "$LOT" in
        6G) npx --no-install eslint api/src/services/workspaces api/src/routes/workspaces.ts api/src/scripts/init-workspace-authority.ts ;;
        *) npx --no-install eslint api/src/services/facets ;;
      esac
      ;;
  esac
  case "$1" in
    verify|test-api)
      LOG_LEVEL=info npm run db:migrate --workspace=api
      LOG_LEVEL=info npm run db:migrate --workspace=api
      cd api
      set -f
      ../node_modules/.bin/vitest run --config vitest.isolated.config.ts $2
      ;;
  esac
  if [ "$1" = verify ] && [ "$LOT" = 6F ]; then bash /workspace/tools/make/paniers-lot6-mutation.sh; fi
  if [ "$1" = verify ] && [ "$LOT" = 6G ]; then bash /workspace/tools/make/paniers-lot6g-mutation.sh; fi
' -- "$1" "$SCOPE" 2>&1 | tee "$log_dir/$1.log"
