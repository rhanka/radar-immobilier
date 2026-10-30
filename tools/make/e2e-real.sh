#!/usr/bin/env bash
# Real-stack Playwright suite (6H): production api/ui images on a synthetic
# database, one compose project per test ENV, always torn down with down -v.
# Usage (through Make only):
#   make test-e2e ENV=test-e2e        run the suite (teardown on exit)
#   make test-e2e-down ENV=test-e2e   teardown only (CI `if: always()`)
set -euo pipefail
env_name="${ENV:-}"
case "$env_name" in
  test-*) ;;
  *) echo "[test-e2e] refused: ENV=$env_name is not a test-* environment (synthetic data only)" >&2; exit 2;;
esac
project="radar-${env_name}"
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROFILES
compose=(docker compose --env-file /dev/null -p "$project" -f docker-compose.yml -f docker-compose.e2e.yml)
down() { "${compose[@]}" --profile e2e down -v --remove-orphans > /dev/null 2>&1 || true; }
if [ "${1:-run}" = "down" ]; then
  down
  echo "[test-e2e] $project torn down (volumes removed)"
  exit 0
fi
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}" tmp/e2e-real
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
until flock -w 30 8; do echo "[test-e2e] waiting for the Docker campaign lock"; done
cleanup() {
  status=$?
  "${compose[@]}" logs --no-color api ui > tmp/e2e-real/stack.log 2>&1 || true
  down
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" build api ui
"${compose[@]}" up -d --wait postgres minio
"${compose[@]}" --profile e2e run --rm -T e2e prepare
"${compose[@]}" up -d api ui
"${compose[@]}" --profile e2e run --rm -T e2e run
