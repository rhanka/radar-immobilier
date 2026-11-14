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
# UIDFIX-EX1: compose interpolates UID/GID for the host-user mapping
# (docker-compose.e2e.yml); bash sets UID but does not export it.
export UID="$(id -u)" GID="$(id -g)"
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
# UIDFIX-EX1: pre-create the named-volume mount points host-side so
# Docker does not create them as root-owned stubs in the workspace.
mkdir -p node_modules api/node_modules ui/node_modules packages/immo-mcp/node_modules
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
"${compose[@]}" --profile e2e build e2e
"${compose[@]}" up -d --wait postgres minio
# UIDFIX-EX1: fresh named volumes are root-owned; hand them (and the
# e2e state volume) to the host user once, as root, before the
# UID-mapped runner installs into them.
"${compose[@]}" --profile e2e run --rm -T -u 0:0 --entrypoint sh e2e -c 'chown -R '"$(id -u):$(id -g)"' /workspace/node_modules /workspace/api/node_modules /workspace/ui/node_modules /workspace/packages/immo-mcp/node_modules /e2e-state'
"${compose[@]}" --profile e2e run --rm -T e2e prepare
"${compose[@]}" up -d api ui
"${compose[@]}" --profile e2e run --rm -T -e E2E_SPEC e2e run
