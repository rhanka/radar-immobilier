#!/usr/bin/env bash
set -euo pipefail
case "$ENV" in test-*|e2e-*) ;; *) exit 2;; esac
task_dir="$PWD/tmp/paniers-6f"
mkdir -p "$task_dir/logs"
export COMPOSE_DISABLE_ENV_FILE=1
export COMPOSE_PROJECT_NAME="radar-$ENV"
export POSTGRES_USER=radar POSTGRES_PASSWORD=synthetic-only POSTGRES_DB=radar
export S3_REGION=test S3_BUCKET=synthetic S3_ACCESS_KEY=synthetic S3_SECRET_KEY=synthetic
export OPENAI_API_KEY= ANTHROPIC_API_KEY= GEMINI_API_KEY= GOOGLE_API_KEY= MISTRAL_API_KEY= COHERE_API_KEY=
cat > "$task_dir/compose.yml" <<YAML
services:
  api:
    entrypoint: []
    command: ["sleep", "infinity"]
    volumes: !override
      - $task_dir/source.tar:/source.tar:ro
      - $task_dir/logs:/evidence
      - runtime:/workspace
    environment:
      NODE_ENV: test
      LOG_LEVEL: silent
      LOT_MIGRATION_DB_TEST: '1'
volumes:
  runtime:
YAML
compose=(docker compose --env-file /dev/null -p "radar-$ENV" -f docker-compose.yml -f docker-compose.test.yml -f "$task_dir/compose.yml")
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
  "${compose[@]}" down -v --remove-orphans || { [[ $task_status != 0 ]] || task_status=1; }
  exit "$task_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Only source/manifests: environment files, Git metadata and host dependencies
# are excluded before reading file contents. The container sees no host tree.
tar --exclude='.env*' --exclude=node_modules --exclude=dist --exclude=.svelte-kit \
  -cf "$task_dir/source.tar" api packages ui tools/make package.json package-lock.json tsconfig.base.json eslint.config.js
"${compose[@]}" up -d --wait postgres
"${compose[@]}" run --rm --no-deps -T api sh -ec '
  tar -xf /source.tar
  npm ci --ignore-scripts --no-audit --no-fund
  cat > /workspace/api/vitest.isolated.config.ts <<'"'"'CONFIG'"'"'
import config from "./vitest.config.js";
export default { ...config, envDir: false, test: { ...config.test, maxWorkers: 2 } };
CONFIG
  case "$1" in
    verify|typecheck) npm run typecheck --workspace=api ;;
  esac
  case "$1" in
    verify|lint) npx --no-install eslint api/src/services/facets ;;
  esac
  case "$1" in
    verify|test-api)
      npm run db:migrate --workspace=api
      cd api
      ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "$2"
      ;;
  esac
  if [ "$1" = verify ]; then bash /workspace/tools/make/paniers-lot6-mutation.sh; fi
' -- "$1" "$SCOPE" 2>&1 | tee "$task_dir/logs/$1.log"
