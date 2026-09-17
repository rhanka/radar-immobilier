#!/bin/sh
set -eu
: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}" "${POSTGRES_DB:?}"
export PGPASSWORD="$POSTGRES_PASSWORD"
now="$(date -u +%Y%m%dT%H%M%SZ)"
dump="/work/radar-${now}.dump"
pg_dump -h "${PGHOST:-radar-postgres}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-privileges --file="$dump"
test -s "$dump"
sha256sum "$dump" > "${dump}.sha256"
printf '%s\n' "$now" > /work/created-at
