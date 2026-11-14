#!/usr/bin/env bash
set -euo pipefail
[[ $ENV == test-mcp-signal-write ]]
mode=${1:?}
runner_image=node:24-bookworm-slim
[[ $mode != test-ui-e2e ]] || runner_image=radar-immobilier-e2e:dev
run_dir="$PWD/tmp/mcp-signal-write-test"
mkdir -p "$run_dir"
exec 9>"$run_dir/campaign.lock"
flock 9
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_ENV_FILES COMPOSE_FILE COMPOSE_PROFILES
cat > "$run_dir/compose.yml" <<YAML
services:
  postgres:
    image: postgis/postgis:16-3.4
    environment: {POSTGRES_USER: radar, POSTGRES_PASSWORD: synthetic-only, POSTGRES_DB: radar}
    tmpfs: [/var/lib/postgresql/data]
    healthcheck:
      test: [CMD-SHELL, "pg_isready -U radar -d radar"]
      interval: 1s
      retries: 30
  check:
    image: $runner_image
    entrypoint: []
    working_dir: /workspace
    volumes:
      - "$PWD:/source:ro"
      - runtime:/workspace
      - "$HOME/.npm:/cache"
      - "$run_dir:/evidence"
    environment:
      NODE_ENV: test
      POSTGRES_HOST: postgres
      POSTGRES_USER: radar
      POSTGRES_PASSWORD: synthetic-only
      POSTGRES_DB: radar
      MCP_SIGNAL_DB_TEST: '1'
      LOT_MIGRATION_DB_TEST: '1'
      DOTENV_CONFIG_PATH: /dev/null
      npm_config_cache: /cache
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: synthetic
      S3_SECRET_KEY: synthetic
  minio:
    image: adobe/s3mock:3.12.0
    environment:
      COM_ADOBE_TESTING_S3MOCK_HTTPPORT: '9000'
      initialBuckets: radar-immobilier-raw,radar-immobilier-docs
      JAVA_TOOL_OPTIONS: '-Xms64m -Xmx256m'
volumes:
  runtime:
YAML
compose=(docker compose --env-file /dev/null -p "radar-$ENV" -f "$run_dir/compose.yml")
trap '"${compose[@]}" down -v --remove-orphans' EXIT
"${compose[@]}" up -d --wait postgres
if [[ $mode == test-ui-e2e ]]; then "${compose[@]}" up -d minio; fi
"${compose[@]}" run --rm --no-deps -T check bash -ec '
  tar -C /source --exclude=".env*" --exclude="*/.env*" --exclude=.git --exclude=tmp --exclude=node_modules --exclude="*/node_modules" -cf - . | tar -C /workspace -xf -
  npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
  exec bash tools/make/mcp-signal-write-container.sh "$1" "$2"
' -- "$mode" "${SCOPE:-}" 2>&1 | tee "$run_dir/$mode.log"
