#!/usr/bin/env bash
set -euo pipefail
unset COMPOSE_ENV_FILES COMPOSE_FILE COMPOSE_PROFILES
compose=(docker compose --env-file /dev/null -p radar-test-prod-cutover -f deploy/prod-cutover/test.compose.yml)
work=$(mktemp -d)
export CUTOVER_TEST_OUTPUT="$work"
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" up -d --wait --wait-timeout 40
# The image's initialization server accepts Unix sockets before initdb is complete.
# Only the final server listens on TCP. Do not race it with the first test query.
ready=0
for attempt in {1..40}; do
  if "${compose[@]}" exec -T postgres pg_isready -h 127.0.0.1 -U radar -d radar_cutover_test >/dev/null; then ready=1; break; fi
  sleep 1
done
[[ $ready == 1 ]]
cat > "$work/psql" <<'SH'
#!/usr/bin/env bash
exec docker compose --env-file /dev/null -p radar-test-prod-cutover -f deploy/prod-cutover/test.compose.yml exec -T postgres psql -U radar -d "$PGDATABASE" "$@"
SH
chmod 700 "$work/psql"
for bin in pg_dump pg_restore; do
  cat > "$work/$bin" <<'SH'
#!/usr/bin/env bash
exec docker compose --env-file /dev/null -p radar-test-prod-cutover -f deploy/prod-cutover/test.compose.yml exec -T -e PGDATABASE="$PGDATABASE" postgres "$(basename "$0")" -U radar "$@"
SH
  chmod 700 "$work/$bin"
done
PATH="$work:$PATH" OUTPUT="$work" PGHOST=127.0.0.1 PGUSER=radar PGDATABASE=radar_cutover_test ENV=test-prod-cutover node --test deploy/prod-cutover/transactions.integration.cjs
