#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-cutover ]]
export COMPOSE_DISABLE_ENV_FILE=1
# UIDFIX-EX2: standalone runner (never includes the root Makefile);
# bash sets UID but does not export it, so export the real host ids
# for the compose user: interpolation in deploy/cutover/test.compose.yml.
export UID="$(id -u)" GID="$(id -g)"
unset COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROFILES
# Pre-create the named-volume mount points host-side so Docker does
# not create them as root-owned stubs in the workspace bind.
mkdir -p node_modules api/node_modules
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
compose=(docker compose --env-file /dev/null -p radar-test-cutover -f deploy/cutover/test.compose.yml)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
while :; do
  if ! flock -w 30 8; then echo 'Waiting for Docker campaign lock'; continue; fi
  busy=$(docker ps --format '{{.Label "com.docker.compose.project"}}' | awk 'NF && $0!="radar-test-cutover"')
  [[ -n $busy ]] || break
  flock -u 8
  echo 'Waiting for the active Docker test stack'; sleep 30
done
# UIDFIX-EX2: build the baked-tools image, then hand the fresh named
# volumes to the host user once (one-off root run) before the first
# UID-mapped npm ci, mirroring chown-test-node-modules in the Makefile.
"${compose[@]}" build api
"${compose[@]}" run --rm --no-deps -T -u 0:0 --entrypoint sh api -c "[ \"\$(stat -c %u /workspace/node_modules)\" = \"$UID\" ] || chown -R $UID:$GID /workspace/node_modules /workspace/api/node_modules"
case ${1:-} in
  test) command='npm ci --ignore-scripts --silent && HOME=$(mktemp -d) node --test --test-name-pattern="${TEST_PATTERN:-.}" tools/make/cutover*.test.mjs && node deploy/ci/bascule-preprod/backup.selftest.mjs && node deploy/ci/backup/backup-daily.selftest.mjs && node deploy/ci/bascule-2tenants/orchestrator.selftest.mjs';;
  lint) command='npm ci --ignore-scripts --silent && npx eslint .';;
  typecheck) command='npm ci --ignore-scripts --silent && npm run typecheck --workspaces --if-present';;
  test-api)
    "${compose[@]}" up -d --wait postgres
    "${compose[@]}" exec -T postgres bash -s < deploy/cutover/parallel-restore.test.sh
    "${compose[@]}" exec -T postgres bash /cutover/atomic-restore.test.sh
    command='npm ci --ignore-scripts --silent && npm run db:migrate --workspace=api && node --test deploy/cutover/database.test.cjs && npm run test --workspace=api -- tests/integration/database-cutover.spec.ts src/services/facets/activation src/services/facets/attachment src/services/facets/base-api-personal-activation src/services/facets/base-api-activation src/services/facets/lots/lot-cutover --maxWorkers=2';;
  *) exit 2;;
esac
"${compose[@]}" run --rm --no-deps -T -e TEST_PATTERN api bash -ec "$command"
