#!/usr/bin/env bash
# Local test container only: prove the custom archive supports a parallel target.
set -euo pipefail
[[ $POSTGRES_PASSWORD == synthetic-only && $POSTGRES_DB == radar ]]
export PGUSER=$POSTGRES_USER PGPASSWORD=$POSTGRES_PASSWORD PGHOST=127.0.0.1 PGDATABASE=radar
cleanup() {
  dropdb --if-exists radar_next >/dev/null
  psql -X -v ON_ERROR_STOP=1 -c 'DROP TABLE IF EXISTS cutover_prepare_sentinel' >/dev/null
  rm -f /tmp/cutover-parallel.dump
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 -c 'CREATE TABLE cutover_prepare_sentinel (id int); INSERT INTO cutover_prepare_sentinel VALUES (42)' >/dev/null
pg_dump --format=custom --file=/tmp/cutover-parallel.dump
createdb --template=template0 radar_next
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -j 4 --dbname=radar_next /tmp/cutover-parallel.dump
[[ $(psql -X -At -c 'SELECT id FROM cutover_prepare_sentinel') == 42 ]]
[[ $(psql -X -At --dbname=radar_next -c 'SELECT id FROM cutover_prepare_sentinel') == 42 ]]
printf 'Parallel restore preserved the live database and restored the target\n'
