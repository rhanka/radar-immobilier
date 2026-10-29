#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-cutover ]]
export COMPOSE_DISABLE_ENV_FILE=1
unset COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROFILES
exec 8>"${XDG_CACHE_HOME:-$HOME/.cache}/radar-docker-campaign.lock"
compose=(docker compose --env-file /dev/null -p radar-test-cutover -f deploy/cutover/test.compose.yml)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
while :; do
  if ! flock -w 30 8; then echo 'Waiting for Docker campaign lock'; continue; fi
  busy=$(docker ps --format '{{.Names}}' | awk '/^radar-test-|^radar-e2e-/ && !/^radar-test-cutover-/')
  [[ -n $busy ]] || break
  flock -u 8
  echo 'Waiting for the active Docker test stack'; sleep 30
done
case ${1:-} in
  test) command='apt-get update -qq && apt-get install -y -qq bash jq curl gettext-base >/dev/null && npm ci --ignore-scripts --silent && node --test tools/make/cutover*.test.mjs && node deploy/ci/bascule-preprod/backup.selftest.mjs';;
  lint) command='npm ci --ignore-scripts --silent && npx eslint .';;
  typecheck) command='npm ci --ignore-scripts --silent && npm run typecheck --workspace=api';;
  test-api)
    "${compose[@]}" up -d --wait postgres
    command='npm ci --ignore-scripts --silent && npm run db:migrate --workspace=api && npm run test --workspace=api -- tests/integration/database-cutover.spec.ts';;
  *) exit 2;;
esac
"${compose[@]}" run --rm --no-deps -T api bash -ec "$command"
