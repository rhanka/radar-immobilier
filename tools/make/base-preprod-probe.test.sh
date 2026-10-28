#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-* ]]
mkdir -p tmp/vehicle-evidence
export COMPOSE_DISABLE_ENV_FILE=1
compose=(docker compose --env-file /dev/null -f deploy/base-preprod/probe.compose.yml -p "radar-$ENV-probe")
trap '"${compose[@]}" down -v --remove-orphans > tmp/vehicle-evidence/probe-cleanup.log 2>&1' EXIT
"${compose[@]}" run --rm --no-deps -T fixture --test tools/make/base-preprod-probe.test.mjs tools/make/base-preprod-cdp-client.test.mjs
