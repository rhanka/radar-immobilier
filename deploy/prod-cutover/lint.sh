#!/usr/bin/env bash
set -euo pipefail
unset COMPOSE_ENV_FILES COMPOSE_FILE COMPOSE_PROFILES
compose=(env UID="$(id -u)" GID="$(id -g)" docker compose --env-file /dev/null -p radar-test-prod-cutover-lint -f deploy/cutover/test.compose.yml)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" run --rm --no-deps -T -u 0:0 --entrypoint sh api -c "chown $(id -u):$(id -g) /workspace/node_modules /workspace/api/node_modules"
"${compose[@]}" run --rm --no-deps -T api bash -ec 'npm ci --ignore-scripts --silent && npx eslint deploy/prod-cutover/*.cjs'
