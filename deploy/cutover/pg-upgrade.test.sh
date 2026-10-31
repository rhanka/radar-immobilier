  #!/usr/bin/env bash
# Local test stack only (deploy/cutover/test.compose.yml, ENV=test-cutover):
# PG16 (postgres16) -> PG18 (postgres) through the real operator verbs.
# Covers: refusal of a table without replica identity, schema copy of the real
# migrations, initial copy, live writes, pg-verify, pg-switch with reverse
# replication, rollback to PG16, switch again, abort cleanup, and the
# cross-version dump/restore paths (pg_dump 16 archive -> PG18, pg_dump 18 -> PG16).
set -euo pipefail
compose=(docker compose --env-file /dev/null -p radar-test-cutover -f deploy/cutover/test.compose.yml)
STATE=$(mktemp -d); trap 'rm -rf "$STATE"' EXIT
DB=radar_next
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok - %s\n' "$*"; }
svc() { if [[ $1 == pg18 ]]; then echo postgres; else echo postgres16; fi; }
# Operator session (never frozen) and application session (subject to the freeze).
op() { "${compose[@]}" exec -T "$(svc "$1")" env PGOPTIONS='-c default_transaction_read_only=off' psql -X -q -At -v ON_ERROR_STOP=1 -U radar -d "$2" -c "$3"; }
app() { "${compose[@]}" exec -T "$(svc "$1")" psql -X -q -At -v ON_ERROR_STOP=1 -U radar -d "$2" -c "$3"; }
verb() { make -s -f deploy/cutover/operator.mk "$@" PG_STATE_DIR="$STATE" ENV=test-cutover; }
eventually() {   # eventually <side> <sql> <expected>
  local i
  for i in $(seq 1 30); do [[ $(op "$1" "$DB" "$2") == "$3" ]] && return 0; sleep 1; done
  fail "$1: '$2' never returned '$3' (last: $(op "$1" "$DB" "$2"))"
}

# PG16 live database shaped like preprod: image extensions (topology/tiger),
# the real migrations, then synthetic data in edge-case columns.
op pg16 postgres "CREATE DATABASE $DB"
op pg16 "$DB" 'CREATE EXTENSION postgis; CREATE EXTENSION postgis_topology; CREATE EXTENSION fuzzystrmatch; CREATE EXTENSION postgis_tiger_geocoder'
"${compose[@]}" run --rm --no-deps -T -e POSTGRES_HOST=postgres16 -e POSTGRES_DB=$DB api bash -ec \
  'npm ci --ignore-scripts --silent && npm run db:migrate --workspace=api' >/dev/null
op pg16 "$DB" "
CREATE SCHEMA pgup_synthetic;
CREATE TABLE pgup_synthetic.nodes (id bigserial PRIMARY KEY, label text,
  label_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(label, ''))) STORED,
  geom geometry(Point, 4326), payload jsonb, at timestamptz DEFAULT now());
CREATE INDEX ON pgup_synthetic.nodes USING gist (geom);
CREATE INDEX ON pgup_synthetic.nodes USING gin (label gin_trgm_ops);
INSERT INTO pgup_synthetic.nodes (label, geom, payload)
  SELECT 'node ' || g, ST_SetSRID(ST_MakePoint(-74 + g / 1e5, 45), 4326), jsonb_build_object('g', g, 'f', g / 3.0)
  FROM generate_series(1, 20000) g;
CREATE TABLE pgup_synthetic.loose (k int, v text);
CREATE ROLE pgup_reader LOGIN PASSWORD 'synthetic-only';
GRANT USAGE ON SCHEMA pgup_synthetic TO pgup_reader;
GRANT SELECT ON pgup_synthetic.nodes TO pgup_reader;"

if verb pg-replicate 2>"$STATE/err"; then fail 'a table without replica identity was accepted'; fi
grep -q 'pgup_synthetic.loose' "$STATE/err" || fail "unexpected refusal: $(cat "$STATE/err")"
pass 'table without primary key or replica identity refused before any change'
op pg16 "$DB" 'ALTER TABLE pgup_synthetic.loose REPLICA IDENTITY FULL; INSERT INTO pgup_synthetic.loose VALUES (1, $$a$$), (2, $$b$$)'

POLL_SECONDS=1 verb pg-replicate
[[ $(op pg18 "$DB" "SELECT count(*) FROM pg_extension WHERE extname IN ('postgis_topology','postgis_tiger_geocoder','fuzzystrmatch')") == 0 ]] \
  || fail 'unused image extensions recreated on PG18'
[[ $(op pg18 "$DB" "SELECT extversion FROM pg_extension WHERE extname='postgis'") == 3.6* ]] || fail 'PostGIS is not 3.6 on PG18'
[[ $(op pg18 "$DB" 'SELECT count(*) FROM pgup_synthetic.nodes') == 20000 ]] || fail 'initial copy incomplete'
pass 'schema (real migrations) and data copied; topology/tiger left out'

op pg16 "$DB" "UPDATE pgup_synthetic.nodes SET label = 'renamed' WHERE id <= 10; DELETE FROM pgup_synthetic.nodes WHERE id = 20000;
  DELETE FROM pgup_synthetic.loose WHERE k = 2; INSERT INTO pgup_synthetic.nodes (label) VALUES ('late')"
eventually pg18 "SELECT count(*) FROM pgup_synthetic.nodes WHERE label = 'renamed'" 10
eventually pg18 "SELECT label_tsv::text FROM pgup_synthetic.nodes WHERE label = 'late'" "'late':1"
verb pg-verify
pass 'live changes replicated; pg-verify equal (rows, ordered md5, privileges)'

verb pg-switch TARGET=pg18
[[ $(cat "$STATE/active") == pg18 ]] || fail 'switch did not select PG18'
jq -e '.action=="switch" and .active=="pg18" and .freezeSeconds < 60 and .reverse' "$STATE/receipt.json" >/dev/null \
  || fail "unexpected receipt $(cat "$STATE/receipt.json")"
if app pg16 "$DB" "INSERT INTO pgup_synthetic.nodes (label) VALUES ('stale writer')" 2>/dev/null; then fail 'PG16 accepted an application write after the switch'; fi
id=$(app pg18 "$DB" "INSERT INTO pgup_synthetic.nodes (label) VALUES ('on pg18') RETURNING id")
(( id > 20000 )) || fail "sequence not carried over (id $id)"
eventually pg16 "SELECT count(*) FROM pgup_synthetic.nodes WHERE label = 'on pg18'" 1
verb pg-reverse >/dev/null
verb pg-verify
pass "switch to PG18: PG16 read-only, sequence continued ($id), reverse replication keeps PG16 current"

verb pg-switch TARGET=pg16
app pg16 "$DB" "INSERT INTO pgup_synthetic.nodes (label) VALUES ('after rollback')"
eventually pg18 "SELECT count(*) FROM pgup_synthetic.nodes WHERE label = 'after rollback'" 1
if app pg18 "$DB" "INSERT INTO pgup_synthetic.nodes (label) VALUES ('x')" 2>/dev/null; then fail 'PG18 writable after rollback'; fi
verb pg-verify
pass 'rollback to PG16 without loss; PG18 kept current'

verb pg-switch TARGET=pg18
app pg18 "$DB" "INSERT INTO pgup_synthetic.nodes (label) VALUES ('second switch')"
eventually pg16 "SELECT count(*) FROM pgup_synthetic.nodes WHERE label = 'second switch'" 1
verb pg-verify
pass 'second switch to PG18'

verb pg-replicate ABORT=1
for side in pg16 pg18; do
  [[ $(op "$side" postgres "SELECT (SELECT count(*) FROM pg_replication_slots)+(SELECT count(*) FROM pg_roles WHERE rolname='radar_pgup')") == 0 ]] \
    || fail "$side keeps replication slots or the replication role"
  [[ $(op "$side" "$DB" "SELECT (SELECT count(*) FROM pg_subscription)+(SELECT count(*) FROM pg_publication)") == 0 ]] \
    || fail "$side keeps a subscription or publication"
done
pass 'abort removes subscriptions, publications, slots and the replication role'

# Cross-version archives: production backups are pg_dump 16 archives restored by
# the PG18 client; a PG18 client may also restore into PG16 (rollback by backup).
"${compose[@]}" exec -T postgres16 sh -ec "pg_dump -U radar -Fc -d $DB -n pgup_synthetic" > "$STATE/pg16.dump"
"${compose[@]}" exec -T -e PGPASSWORD=synthetic-only postgres sh -ec "pg_dump -U radar -Fc -h radar-pg16 -d $DB -n pgup_synthetic" > "$STATE/pg18.dump"
op pg18 postgres 'CREATE DATABASE from16' && op pg18 from16 'CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm'
"${compose[@]}" exec -T postgres sh -ec 'pg_restore -U radar --no-owner --exit-on-error -j 4 -d from16' < "$STATE/pg16.dump" \
  || fail 'pg_restore 18 of a pg_dump 16 archive into PG18'
op pg16 postgres 'CREATE DATABASE from18' && op pg16 from18 'CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm'
"${compose[@]}" exec -T -e PGPASSWORD=synthetic-only postgres sh -ec \
  'pg_restore -U radar -h radar-pg16 --no-owner --exit-on-error -d from18' < "$STATE/pg18.dump" \
  || fail 'pg_restore 18 of a pg_dump 18 archive into PG16'
want=$(op pg16 "$DB" 'SELECT count(*) FROM pgup_synthetic.nodes')
[[ $(op pg18 from16 'SELECT count(*) FROM pgup_synthetic.nodes') == "$want" && $(op pg16 from18 'SELECT count(*) FROM pgup_synthetic.nodes') == "$want" ]] \
  || fail 'cross-version restores lost rows'
pass 'pg_dump 16 archive -> PG18 and pg_dump 18 archive -> PG16 (pg_restore 18) restore every row'
