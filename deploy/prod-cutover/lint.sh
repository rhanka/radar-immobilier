#!/usr/bin/env bash
set -euo pipefail
unset COMPOSE_ENV_FILES COMPOSE_FILE COMPOSE_PROFILES
export BUILDX_CONFIG="$HOME/.cache/radar-prod-cutover-buildx"
mkdir -p "$BUILDX_CONFIG"
compose=(env UID="$(id -u)" GID="$(id -g)" docker compose --env-file /dev/null -p "${CUTOVER_LINT_PROJECT:-radar-test-prod-cutover-lint}" -f deploy/cutover/test.compose.yml)
cleanup() { timeout --kill-after=5s 45s "${compose[@]}" down -v --remove-orphans >/dev/null; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" run --rm --no-deps --pull never -T -u 0:0 --entrypoint sh api -c "chown $(id -u):$(id -g) /workspace/node_modules /workspace/api/node_modules"
"${compose[@]}" run --rm --no-deps --pull never -T -v /dev/null:/etc/bash.bashrc:ro -v /dev/null:/etc/profile:ro api bash -ec 'timeout 90s npm ci --ignore-scripts --silent && npx eslint deploy/prod-cutover/*.cjs deploy/prod-cutover/*.mjs && timeout 150s node --test --test-concurrency=1 deploy/prod-cutover/*.test.mjs'
