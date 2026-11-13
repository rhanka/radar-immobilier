#!/usr/bin/env bash
set -euo pipefail
[[ $ENV == test-mcp-signal-write ]]
mode=${1:?}
run_dir="$PWD/tmp/mcp-signal-write-test"
mkdir -p "$run_dir"
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
    image: node:24-bookworm-slim
    working_dir: /workspace
    volumes:
      - "$PWD:/source:ro"
      - runtime:/workspace
      - "$HOME/.npm:/cache"
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
volumes:
  runtime:
YAML
compose=(docker compose --env-file /dev/null -p "radar-$ENV" -f "$run_dir/compose.yml")
trap '"${compose[@]}" down -v --remove-orphans' EXIT
"${compose[@]}" up -d --wait postgres
"${compose[@]}" run --rm --no-deps -T check bash -ec '
  tar -C /source --exclude=".env*" --exclude="*/.env*" --exclude=.git --exclude=tmp --exclude=node_modules --exclude="*/node_modules" -cf - . | tar -C /workspace -xf -
  npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
  exec bash tools/make/mcp-signal-write-container.sh "$1" "$2"
' -- "$mode" "${SCOPE:-}" 2>&1 | tee "$run_dir/$mode.log"
