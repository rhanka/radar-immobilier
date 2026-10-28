#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == preprod && ${PUBLIC_PHASE:-} =~ ^(preflight|q1|q2)$ ]] || {
  echo 'PUBLIC_PHASE=preflight|q1|q2 et ENV=preprod requis' >&2; exit 2;
}
export COMPOSE_DISABLE_ENV_FILE=1
project=radar-preprod-public-$(printf '%s' "$OUTPUT" | sha256sum | cut -c1-12)
compose=(docker compose --env-file /dev/null -f deploy/base-preprod/probe.compose.yml -p "$project")
trap '"${compose[@]}" down -v --remove-orphans > "$OUTPUT/probe-cleanup.log" 2>&1' EXIT
"${compose[@]}" run --rm --no-deps -T operator "$PUBLIC_PHASE" < "$INPUT" > "$OUTPUT/public-qualification.json" 2> "$OUTPUT/probe-transport.log"
jq -e '.passed and .ownedTargetClosed and (.cookiesExported|not) and (.tokensExported|not)' "$OUTPUT/public-qualification.json" >/dev/null
