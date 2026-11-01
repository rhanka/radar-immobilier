#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-cutover ]]
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROFILES
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}"
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
compose=(docker compose --env-file /dev/null -p radar-test-cutover -f deploy/cutover/test.compose.yml)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Serialize test campaigns; unrelated idle stacks need not stop for this portless project.
until flock -w 30 8; do echo 'Waiting for Docker campaign lock'; done
case ${1:-} in
  test) command='apt-get update -qq && apt-get install -y -qq bash make jq curl gettext-base >/dev/null && npm ci --ignore-scripts --silent && HOME=$(mktemp -d) node --test --test-name-pattern="${TEST_PATTERN:-.}" tools/make/cutover*.test.mjs && node deploy/ci/bascule-preprod/backup.selftest.mjs && node deploy/ci/backup/backup-daily.selftest.mjs && node deploy/ci/bascule-2tenants/orchestrator.selftest.mjs';;
  lint) command='npm ci --ignore-scripts --silent && npx eslint .';;
  typecheck) command='npm ci --ignore-scripts --silent && npm run typecheck --workspaces --if-present';;
  test-api)
    "${compose[@]}" up -d --wait postgres
    "${compose[@]}" exec -T postgres bash -s < deploy/cutover/parallel-restore.test.sh
    "${compose[@]}" exec -T postgres bash /cutover/atomic-restore.test.sh
    command='npm ci --ignore-scripts --silent && npm run db:migrate --workspace=api && node --test deploy/cutover/database.test.cjs && npm run test --workspace=api -- tests/integration/database-cutover.spec.ts src/services/facets/activation src/services/facets/attachment src/services/facets/base-api-personal-activation src/services/facets/base-api-activation src/services/facets/lots/lot-cutover src/lifecycle src/routes/cutover-probe.test.ts --maxWorkers=2';;
  *) exit 2;;
esac
"${compose[@]}" run --rm --no-deps -T -e TEST_PATTERN api bash -ec "$command"
