#!/usr/bin/env bash
# Local test container only: restore a snapshot taken at N migrations onto a
# database at N+k migrations whose newer foreign keys depend on a primary key
# of the snapshot (the 2026-10-30 preprod failure), atomically and twice.
set -euo pipefail
[[ $POSTGRES_PASSWORD == synthetic-only && $POSTGRES_DB == radar ]]
export PGUSER=$POSTGRES_USER PGPASSWORD=$POSTGRES_PASSWORD PGHOST=127.0.0.1 PGDATABASE=radar
restore=/cutover/atomic-restore.sh
work=$(mktemp -d)
cleanup() {
  for db in atomic_src atomic_live atomic_next; do dropdb --if-exists --force "$db" >/dev/null 2>&1 || true; done
  rm -rf "$work"
}
trap cleanup EXIT
q() { psql -X -At -v ON_ERROR_STOP=1 --dbname="$1" -c "$2"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
schema_n() {
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$1" <<'SQL'
CREATE EXTENSION postgis;
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL);
INSERT INTO drizzle.__drizzle_migrations (hash) SELECT 'm' || g FROM generate_series(1, 13) g;
CREATE TABLE account_users (id bigint PRIMARY KEY, sub text NOT NULL);
CREATE TABLE workspaces (id bigint PRIMARY KEY, owner_id bigint NOT NULL REFERENCES account_users (id),
  area geometry(Point, 4326));
INSERT INTO account_users SELECT g, 'sub-' || g FROM generate_series(1, 6) g;
INSERT INTO workspaces SELECT g, 1 + g % 6, ST_SetSRID(ST_MakePoint(-74, 45), 4326) FROM generate_series(1, 50) g;
CREATE TABLE bulk (id int PRIMARY KEY, payload text);
INSERT INTO bulk SELECT g, md5(g::text) FROM generate_series(1, 200000) g;
SQL
}
upgrade_to_n_plus_k() {
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$1" <<'SQL'
INSERT INTO drizzle.__drizzle_migrations (hash) SELECT 'm' || g FROM generate_series(14, 27) g;
ALTER TABLE account_users ADD COLUMN display_name text;
INSERT INTO account_users SELECT g, 'sub-' || g, 'new' FROM generate_series(7, 9) g;
CREATE SCHEMA extra;
CREATE TABLE extra.audit (id int PRIMARY KEY);
DO $$ BEGIN
  FOR i IN 1..20 LOOP
    EXECUTE format('CREATE TABLE member_%s (id int PRIMARY KEY, user_id bigint NOT NULL REFERENCES account_users (id))', i);
    EXECUTE format('INSERT INTO member_%s VALUES (1, 7)', i);
  END LOOP;
END $$;
SQL
}
createdb --template=template0 atomic_src
schema_n atomic_src
pg_dump --format=custom --dbname=atomic_src --file="$work/radar.dump"
toc=$(pg_restore --list "$work/radar.dump" | grep -c '^[0-9]')
createdb --template=template0 atomic_live
schema_n atomic_live
upgrade_to_n_plus_k atomic_live
[[ $(q atomic_live "SELECT count(*) FROM pg_constraint WHERE confrelid = 'account_users'::regclass") == 21 ]] || fail 'fixture FK count'

# Regression reproduction: --clean in one transaction cannot drop account_users_pkey.
if pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction \
  --dbname=atomic_live "$work/radar.dump" 2>"$work/clean.err"; then fail 'legacy --clean restore unexpectedly succeeded'; fi
grep -q 'account_users_pkey' "$work/clean.err" || fail 'legacy failure is not the primary-key dependency'
[[ $(q atomic_live 'SELECT count(*) FROM drizzle.__drizzle_migrations') == 27 ]] || fail 'legacy failure changed the database'

run_restore() {
  PGDATABASE=$1 EXPECTED_DATABASE=$1 TARGET_DB=$2 LIVE_DB=$3 RESTORE_DUMP=$4 EXPECTED_TOC_ENTRIES=$toc \
    RESTORE_ASSERT_DB=1 DUMP_DATABASE=atomic_src bash "$restore"
}
assert_snapshot() {
  [[ $(q "$1" 'SELECT count(*) FROM drizzle.__drizzle_migrations') == 13 ]] || fail "$1 migrations"
  [[ $(q "$1" 'SELECT count(*) FROM account_users') == 6 ]] || fail "$1 accounts"
  [[ $(q "$1" 'SELECT count(*) FROM bulk') == 200000 ]] || fail "$1 bulk rows"
  [[ $(q "$1" "SELECT count(*) FROM workspaces WHERE ST_X(area) = -74") == 50 ]] || fail "$1 postgis data"
  [[ $(q "$1" "SELECT to_regclass('public.member_1') IS NULL AND to_regnamespace('extra') IS NULL") == t ]] || fail "$1 newer objects kept"
  [[ $(q "$1" "SELECT count(*) FROM information_schema.columns WHERE table_name = 'account_users' AND column_name = 'display_name'") == 0 ]] || fail "$1 newer column kept"
  if q "$1" 'INSERT INTO workspaces VALUES (999, 999, NULL)' >/dev/null 2>&1; then fail "$1 foreign key not restored"; fi
}

# Live database: one transaction, then a relaunch from the restored state.
run_restore atomic_live '' '' "$work/radar.dump" > "$work/live.out"
assert_snapshot atomic_live
run_restore atomic_live '' '' "$work/radar.dump" > "$work/live-rerun.out"
assert_snapshot atomic_live

# A truncated archive rolls back the schema reset and every replayed statement.
upgrade_to_n_plus_k atomic_live
q atomic_live 'CREATE SCHEMA guard; CREATE TABLE guard.marker (id int); INSERT INTO guard.marker VALUES (42)' >/dev/null
head -c $(( $(stat -c %s "$work/radar.dump") * 6 / 10 )) "$work/radar.dump" > "$work/truncated.dump"
if run_restore atomic_live '' '' "$work/truncated.dump" > "$work/truncated.out" 2>&1; then fail 'truncated archive restored'; fi
[[ $(q atomic_live 'SELECT id FROM guard.marker') == 42 ]] || fail 'truncated archive did not roll back'
[[ $(q atomic_live 'SELECT count(*) FROM drizzle.__drizzle_migrations') == 27 ]] || fail 'truncated archive changed migrations'

# Prepared database: a non-empty target is reset, then restored with -j 4, twice.
createdb --template=template0 atomic_next
schema_n atomic_next
upgrade_to_n_plus_k atomic_next
if run_restore atomic_next atomic_next atomic_next "$work/radar.dump" > "$work/refused.out" 2>&1; then fail 'live database accepted as target'; fi
[[ $(q atomic_next 'SELECT count(*) FROM drizzle.__drizzle_migrations') == 27 ]] || fail 'refused target was modified'
run_restore atomic_next atomic_next atomic_live "$work/radar.dump" > "$work/next.out"
assert_snapshot atomic_next
run_restore atomic_next atomic_next atomic_live "$work/radar.dump" > "$work/next-rerun.out"
assert_snapshot atomic_next
printf 'Atomic restore replaced N+k with the N snapshot, reran, rolled back a truncated archive and restored a prepared target\n'
