#!/usr/bin/env bash
# Local test container only (cutover-verify.sh test-api): prove a prod-like
# dump replayed through the restore path keeps the preprod-only artifact
# catalogue byte-for-byte.
#
# Scenario: preprod-like databases carry a witness artifact (releases, current
# pointer, ACL, sources, receipts, quotas, delete confirmation, stable URL
# identity); a prod-like dump is replayed with deploy/cutover/atomic-restore.sh
# and its CATALOGUE_DIR hook; the witness must survive with identical bytes,
# identities remapped as designed, and no prod data may land outside preprod.
set -euo pipefail
[[ ${POSTGRES_PASSWORD:-} == synthetic-only ]]
export PGHOST=${PGHOST:-postgres} PGUSER=radar PGPASSWORD=synthetic-only PGPORT=5432
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CATALOGUE=$SCRIPT_DIR/artifacts-catalogue.sh
RESTORE=$SCRIPT_DIR/atomic-restore.sh
MIG_DIR=$SCRIPT_DIR/../../api/drizzle
MIGS="0004_auth_users 0015_artifacts_core 0016_artifacts_lifecycle 0024_artifacts_coordinator 0025_artifacts_actor_quotas 0026_artifacts_reader_tickets 0028_artifacts_p0b 0029_artifacts_parity"
SCOPE=radar-immobilier-preprod
ART=11111111-1111-1111-1111-111111111111
REL1=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
REL2=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
CONF=cccccccc-cccc-cccc-cccc-cccccccccccc
OWNER=witness-owner
READER=witness-reader

work=$(mktemp -d)
cleanup() {
  for db in cat_src cat_prodd cat_prodrej cat_dst cat_dst_map cat_dst2 cat_dst29 cat_src29 cat_prep cat_pu1 cat_pu2 cat_dstu cat_dsts cat_preps cat_sc_src cat_sc cat_sc_miss cat_stale cat_gate1 cat_gate2 cat_full_ok cat_full_ro cat_full_src cat_full_un cat_hash cat_hash2 tmp-prod-x; do
    dropdb --if-exists --force "$db" >/dev/null 2>&1 || true
  done
  rm -rf "$work"
}
trap cleanup EXIT
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
q() { psql -X -At -v ON_ERROR_STOP=1 --dbname="$1" -c "$2"; }

apply_schema() {
  local db="$1"
  createdb --template=template0 "$db"
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$db" \
    -c 'CREATE SCHEMA IF NOT EXISTS drizzle' \
    -c 'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at timestamptz NOT NULL)'
  local i=0 m hash
  for m in $MIGS; do
    i=$((i + 1))
    psql -X -q -v ON_ERROR_STOP=1 --dbname="$db" -f "$MIG_DIR/$m.sql"
    hash=$(sha256sum "$MIG_DIR/$m.sql" | awk '{print $1}')
    psql -X -q -v ON_ERROR_STOP=1 --dbname="$db" -c "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$hash', to_timestamp(1792000001 + $i))"
  done
}

seed_preprod() {
  local db="$1"
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$db" <<SQL
INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('$SCOPE', 'org-preprod');
INSERT INTO artifacts.host_policy (storage_scope_id, revision) VALUES ('$SCOPE', 'test-rev-1');
INSERT INTO artifacts.host_quotas (storage_scope_id, operation_limit, byte_limit, operations_used, bytes_used)
  VALUES ('$SCOPE', 1000, 1000000000, 3, 300);
INSERT INTO artifacts.host_actor_quotas (storage_scope_id, actor_id, operation_limit, byte_limit, operations_used, bytes_used)
  VALUES ('$SCOPE', '$OWNER', 100, 100000000, 1, 100);
INSERT INTO public.account_users (id, sub, email, status) VALUES
  ('10000000-0000-0000-0000-000000000001', '$OWNER', 'owner@example.test', 'approved'),
  ('10000000-0000-0000-0000-000000000002', '$READER', 'reader@example.test', 'approved');
INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile)
  VALUES ('$ART', '$SCOPE', '$OWNER', 'witness-binding', '{}');
INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state) VALUES
  ('$REL1', '$ART', 'aaa', '{"files":{"index.html":"sha256:aaa"}}', 'ready'),
  ('$REL2', '$ART', 'bbb', '{"files":{"index.html":"sha256:bbb"}}', 'retired');
INSERT INTO artifacts.artifact_current (artifact_id, release_id) VALUES ('$ART', '$REL1');
INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ('$ART', '$READER', 'read');
INSERT INTO artifacts.artifact_sources (artifact_id, kind) VALUES ('$ART', 'inline-original');
INSERT INTO artifacts.blobs (storage_scope_id, digest, size) VALUES ('$SCOPE', 'aaa', 12), ('$SCOPE', 'bbb', 13);
INSERT INTO artifacts.blob_ref_holders (digest, holder) VALUES ('aaa', 'release:$REL1');
INSERT INTO artifacts.blob_pins (digest, reason) VALUES ('aaa', 'witness');
INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key) VALUES ('$SCOPE', 'op-witness-1');
INSERT INTO artifacts.operation_receipts (storage_scope_id, internal_key, command_codec, command_hash, receipt)
  VALUES ('$SCOPE', 'op-witness-1', 'test', 'h', '{"ok":true,"release":"$REL1"}');
INSERT INTO artifacts.idempotency_keys (key, params_hash, result) VALUES ('idem-1', 'ph', '{"done":true}');
INSERT INTO artifacts.delete_confirmations
  (confirmation_ref, storage_scope_id, actor_id, artifact_id, expected_release_id, command_hash, internal_key, expires_at)
  VALUES ('$CONF', '$SCOPE', '$OWNER', '$ART', '$REL1', 'ch', 'ik-1', now() + interval '1 hour');
INSERT INTO artifacts.object_intents (id, kind, state, payload) VALUES
  ('20000000-0000-0000-0000-000000000001', 'commit-release', 'done', '{}');
INSERT INTO artifacts.uploads (id, max_size, mime_type, state) VALUES
  ('30000000-0000-0000-0000-000000000001', 1000, 'text/html', 'open');
INSERT INTO artifacts.reader_tickets (ticket_hash, binding_hash, payload, expires_at) VALUES
  ('tick', 'bind', '{}', now() + interval '1 minute');
INSERT INTO artifacts.host_failures (invocation_id, actor_id, operation, reason, status, at_ms)
  VALUES ('inv-1', '$OWNER', 'publish', 'test', 500, 1);
INSERT INTO artifacts.host_actor_rate (storage_scope_id, actor_id, window_start, count)
  VALUES ('$SCOPE', '$OWNER', now(), 2);
CREATE TABLE bulk (id int PRIMARY KEY, payload text);
INSERT INTO bulk VALUES (1, 'preprod-business-row');
SQL
}

seed_prod() {
  local db="$1" rejected="$2"
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$db" <<SQL
INSERT INTO public.account_users (id, sub, email, status) VALUES
  ('40000000-0000-0000-0000-000000000001', 'prod-user', 'prod@example.test', 'approved');
CREATE TABLE bulk (id int PRIMARY KEY, payload text);
INSERT INTO bulk SELECT g, 'prod-row-' || g FROM generate_series(1, 3) g;
SQL
  if [[ "$rejected" == 1 ]]; then
    q "$db" "INSERT INTO public.account_users (id, sub, email, status) VALUES ('40000000-0000-0000-0000-000000000002', '$OWNER', 'owner@example.test', 'rejected')" >/dev/null
  fi
}

restore_with_catalogue() {
  local db="$1" dump="$2" catdir="$3" map="${4:-}" target="${5:-}" live="${6:-}" toc
  toc=$(pg_restore --list "$dump" | grep -c '^[0-9]' || true)
  if [[ -n "$map" ]]; then
    PGDATABASE=$db EXPECTED_DATABASE=$db TARGET_DB="$target" LIVE_DB="$live" RESTORE_DUMP="$dump" EXPECTED_TOC_ENTRIES=$toc \
      RESTORE_ASSERT_DB=0 DUMP_DATABASE=x CATALOGUE_DIR="$catdir" CATALOGUE_SCRIPT="$CATALOGUE" \
      CATALOGUE_MAP="$map" bash "$RESTORE"
  else
    PGDATABASE=$db EXPECTED_DATABASE=$db TARGET_DB="$target" LIVE_DB="$live" RESTORE_DUMP="$dump" EXPECTED_TOC_ENTRIES=$toc \
      RESTORE_ASSERT_DB=0 DUMP_DATABASE=x CATALOGUE_DIR="$catdir" CATALOGUE_SCRIPT="$CATALOGUE" \
      bash "$RESTORE"
  fi
}

assert_witness() {
  local db="$1"
  [[ $(q "$db" "SELECT id::text || '|' || owner_id || '|' || binding_name FROM artifacts.artifacts") == "$ART|$OWNER|witness-binding" ]] || fail "$db artifact identity"
  [[ $(q "$db" 'SELECT count(*) FROM artifacts.releases') == 2 ]] || fail "$db release count"
  [[ $(q "$db" "SELECT md5(manifest) FROM artifacts.releases WHERE id = '$REL1'") == "$(q cat_src "SELECT md5(manifest) FROM artifacts.releases WHERE id = '$REL1'")" ]] || fail "$db release manifest bytes"
  [[ $(q "$db" "SELECT release_id::text FROM artifacts.artifact_current WHERE artifact_id = '$ART'") == "$REL1" ]] || fail "$db current pointer"
  [[ $(q "$db" "SELECT permission FROM artifacts.artifact_access WHERE artifact_id = '$ART'") == read ]] || fail "$db ACL"
  [[ $(q "$db" "SELECT kind FROM artifacts.artifact_sources WHERE artifact_id = '$ART'") == inline-original ]] || fail "$db sources"
  [[ $(q "$db" "SELECT receipt::text FROM artifacts.operation_receipts WHERE internal_key = 'op-witness-1'") == \
     $(q cat_src "SELECT receipt::text FROM artifacts.operation_receipts WHERE internal_key = 'op-witness-1'") ]] || fail "$db receipt bytes"
  [[ $(q "$db" "SELECT operations_used || '/' || bytes_used FROM artifacts.host_quotas WHERE storage_scope_id = '$SCOPE'") == 3/300 ]] || fail "$db quotas"
  [[ $(q "$db" "SELECT count(*) FROM artifacts.delete_confirmations WHERE confirmation_ref = '$CONF'") == 1 ]] || fail "$db delete confirmation"
  [[ $(q "$db" "SELECT count(*) FROM artifacts.blobs WHERE digest = 'aaa'") == 1 ]] || fail "$db blob registry"
  [[ $(q "$db" "SELECT count(*) FROM artifacts.blob_pins WHERE digest = 'aaa'") == 1 ]] || fail "$db blob pin"
  for t in reader_tickets uploads object_intents host_failures host_actor_rate; do
    [[ $(q "$db" "SELECT count(*) FROM artifacts.$t") == 0 ]] || fail "$db ephemeral $t leaked"
  done
  printf 'Witness survives in %s: stable https://%s.preprod.immo-pages.sent-tech.ca/ pinned https://%s.pinned.preprod.immo-pages.sent-tech.ca/\n' \
    "$db" "$ART" "$REL1"
}

# ── Fixtures ──────────────────────────────────────────────────────────────
apply_schema cat_src; seed_preprod cat_src
apply_schema cat_prodd; seed_prod cat_prodd 0
apply_schema cat_prodrej; seed_prod cat_prodrej 1
for db in cat_dst cat_dst_map cat_dst2 cat_dst29; do apply_schema "$db"; done
# cat_dst plays the live preprod database: it carries the witness catalogue
# before the prod dump is replayed over it. The schema-only databases play
# prepared candidates fed by a pre-sealed live export.
seed_preprod cat_dst
pg_dump --format=custom --dbname=cat_prodd --file="$work/prod.dump"
pg_dump --format=custom --dbname=cat_prodrej --file="$work/prodrej.dump"

# ── Export from preprod, archive holds catalogue rows only ────────────────
PGDATABASE=cat_src bash "$CATALOGUE" export --out-dir "$work/export" || fail 'export refused'
[[ -f $work/export/manifest.json ]] || fail 'manifest missing'
if pg_restore --list "$work/export/catalogue.dump" | grep -E '^[0-9]+;' | grep -v 'SCHEMA artifacts' | grep -Eq 'TABLE DATA (public|drizzle)'; then
  fail 'export archive leaks non-catalogue data'
fi
if ! PGDATABASE=cat_src bash "$CATALOGUE" verify --in-dir "$work/export" >/dev/null; then
  echo '--- fingerprints.tsv:'; cat "$work/export/fingerprints.tsv"
  echo '--- manifest table entries:'; grep -o '{"name":"[^"]*","rows":[^,}]*' "$work/export/manifest.json" || true
  echo '--- exact rows probe:'; tr '\n' ' ' < "$work/export/manifest.json" | grep -o '{"name":"blob_pins","rows":[^,}]*' | sed -n "1s/.*\"rows\"://p" | tr -d '"'; echo "rows-probe-status=$?"
  echo '--- exact fingerprint probe:'; tr '\n' ' ' < "$work/export/manifest.json" | grep -o '{"name":"blob_pins","fingerprint":[^,}]*' | sed -n "1s/.*\"fingerprint\"://p" | tr -d '"'; echo "fp-probe-status=$?"
  echo '--- manifest head:'; head -c 700 "$work/export/manifest.json"; echo
  fail 'export not self-consistent'
fi

# ── L0 gate: GO on a small catalogue, NO-GO on budget and prod ────────────
PGDATABASE=cat_src bash "$CATALOGUE" gate --target-db cat_dst > "$work/gate.json" || fail 'gate should be GO'
grep -q '"verdict":"GO"' "$work/gate.json" || fail 'gate verdict not GO'
if PGDATABASE=cat_src bash "$CATALOGUE" gate --target-db cat_dst --max-bytes 1 >/dev/null 2>&1; then fail 'gate ignores byte budget'; fi
if PGDATABASE=cat_src bash "$CATALOGUE" gate --target-db preprod-prod-x >/dev/null 2>&1; then fail 'gate allows prod target'; fi

# ── Daily path: fresh pre-seal export inside the restore, witness survives ──
if ! restore_with_catalogue cat_dst "$work/prod.dump" "$work/cat-dst" > "$work/restore-dst.out" 2>&1; then
  echo '--- restore-dst.out:'; cat "$work/restore-dst.out"
  fail 'restore with catalogue refused'
fi
grep -q 'catalogue' "$work/restore-dst.out" || fail 'catalogue hook did not run'
assert_witness cat_dst
[[ $(q cat_dst 'SELECT payload FROM bulk ORDER BY 1' | tr '\n' ' ') == 'prod-row-1 prod-row-2 prod-row-3 ' ]] || fail 'prod data not restored'
[[ $(q cat_dst "SELECT status FROM public.account_users WHERE sub = '$OWNER'") == pending ]] || fail 'unattended import minted an approval'
grep -q "created:pending" "$work/cat-dst/export/reconciliation.tsv" || fail 'reconciliation report missing'
# Source and prod origins untouched: no prod data written outside preprod.
[[ $(q cat_src "SELECT payload FROM bulk") == preprod-business-row ]] || fail 'preprod source mutated'
[[ $(q cat_prodd 'SELECT count(*) FROM artifacts.artifacts') == 0 ]] || fail 'prod origin mutated'
[[ $(q cat_src 'SELECT count(*) FROM artifacts.artifacts') == 1 ]] || fail 'preprod source catalogue mutated'

# ── Supervised path: explicit map restores approvals ───────────────────────
printf '%s\tapproved\n%s\n' "$OWNER" "$READER" > "$work/map.tsv"
# Pre-seal the export so the hook reuses the sealed generation.
PGDATABASE=cat_src bash "$CATALOGUE" export --out-dir "$work/cat-map-export" >/dev/null || fail 'map export refused'
mkdir -p "$work/cat-map"; cp -r "$work/cat-map-export" "$work/cat-map/export"
restore_with_catalogue cat_dst_map "$work/prod.dump" "$work/cat-map" "$work/map.tsv" > "$work/restore-map.out" 2>&1 || fail 'mapped restore refused'
grep -q 'already sealed' "$work/restore-map.out" || fail 'sealed export not reused'
assert_witness cat_dst_map
[[ $(q cat_dst_map "SELECT status FROM public.account_users WHERE sub = '$OWNER'") == approved ]] || fail 'explicit mapping did not restore approval'
[[ $(q cat_dst_map "SELECT status FROM public.account_users WHERE sub = '$READER'") == approved ]] || fail 'exported approval not kept via map'

# ── Prepared database (blue/green rehearsal): never export from candidate ──
apply_schema cat_prep
if restore_with_catalogue cat_prep "$work/prod.dump" "$work/cat-prep" "" "cat_prep" "cat_dst" >/dev/null 2>&1; then fail 'prepared restore without pre-seal accepted'; fi
[[ $(q cat_prep "SELECT count(*) FROM information_schema.schemata WHERE schema_name = 'artifacts'") == 1 ]] || fail 'refused prepared restore touched the candidate'
[[ $(q cat_prep "SELECT count(*) FROM information_schema.tables WHERE table_name = 'bulk'") == 0 ]] || fail 'refused prepared restore replayed prod'
mkdir -p "$work/cat-prep2"; PGDATABASE=cat_src bash "$CATALOGUE" export --out-dir "$work/cat-prep2/export" >/dev/null || fail 'live export for candidate refused'
restore_with_catalogue cat_prep "$work/prod.dump" "$work/cat-prep2" "" "cat_prep" "cat_dst_map" || fail 'pre-sealed prepared restore refused'
assert_witness cat_prep
[[ $(q cat_prep 'SELECT payload FROM bulk ORDER BY 1' | tr '\n' ' ') == 'prod-row-1 prod-row-2 prod-row-3 ' ]] || fail 'prepared prod data not restored'

# ── Divergence: prod-rejected subject approved in preprod refuses ──────────
mkdir -p "$work/cat-div"; cp -r "$work/export" "$work/cat-div/export"
if restore_with_catalogue cat_dst2 "$work/prodrej.dump" "$work/cat-div" >/dev/null 2>&1; then fail 'revoked-identity divergence accepted'; fi
[[ $(q cat_dst2 'SELECT count(*) FROM artifacts.artifacts') == 0 ]] || fail 'refused import left catalogue rows'
[[ $(q cat_dst2 'SELECT count(*) FROM bulk') == 3 ]] || fail 'refused import damaged prod replay'

# ── Schema-version awareness (drifted source refused both directions) ─────
apply_schema cat_src29; seed_preprod cat_src29
q cat_src29 "ALTER TABLE artifacts.artifacts ADD COLUMN drift_extra JSONB NOT NULL DEFAULT '{}'" >/dev/null
q cat_src29 "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('simulated-drift', to_timestamp(1792100000003))" >/dev/null
PGDATABASE=cat_src29 bash "$CATALOGUE" export --out-dir "$work/export29" >/dev/null || fail 'versioned export refused'
if PGDATABASE=cat_dst29 bash "$CATALOGUE" import --in-dir "$work/export29" >/dev/null 2>&1; then fail 'drifted export accepted on older target'; fi
if PGDATABASE=cat_dst bash "$CATALOGUE" import --in-dir "$work/export29" --allow-same-db >/dev/null 2>&1; then fail 'downgrade accepted'; fi
# Same journal, drifted columns: the column gate (not only the journal) refuses.
q cat_dst "ALTER TABLE artifacts.artifacts ADD COLUMN drift_col TEXT" >/dev/null
if PGDATABASE=cat_dst bash "$CATALOGUE" import --in-dir "$work/export" --allow-same-db >/dev/null 2>&1; then fail 'column drift accepted'; fi
q cat_dst 'ALTER TABLE artifacts.artifacts DROP COLUMN drift_col' >/dev/null
# cat_dst must still match its OWN sealed export (taken by the restore hook):
# cat_src's manifest carries different seed timestamps and never matches it.
PGDATABASE=cat_dst bash "$CATALOGUE" verify --in-dir "$work/cat-dst/export" >/dev/null || fail 'drift rollback damaged catalogue'
# In-flight work blocks the export.
q cat_src29 "INSERT INTO artifacts.object_intents (id, kind, state, payload) VALUES ('20000000-0000-0000-0000-000000000009', 'commit-release', 'pending', '{}')" >/dev/null
if PGDATABASE=cat_src29 bash "$CATALOGUE" export --out-dir "$work/export-pending" >/dev/null 2>&1; then fail 'export with pending intents accepted'; fi

# ── Production name is never a target ─────────────────────────────────────
createdb --template=template0 tmp-prod-x
if PGDATABASE=tmp-prod-x bash "$CATALOGUE" import --in-dir "$work/export" >/dev/null 2>&1; then fail 'prod import accepted'; fi
[[ $(q tmp-prod-x "SELECT count(*) FROM information_schema.schemata WHERE schema_name = 'artifacts'") == 0 ]] || fail 'prod target touched'


# ── Union: prod catalogue + preprod-own catalogue (owner rule 2026-11-15) ──
# prod v1 = P1 + C. Preprod = an earlier restore of v1, then preprod work:
# Q1, Q2 (own), C edited (id collision later), a release under C, Q3 bound
# to 'shared-binding'. prod v2 = v1 + P2 bound to 'shared-binding' (slug
# collision with Q3). Rule: prod wins on any unique key, the preprod row is
# journaled, children of a lost parent are journaled as orphans, never dropped
# silently. Expected union: P1 P2 C(prod) Q1 Q2 = 5 artifacts.
P1=e1000000-0000-0000-0000-000000000001; P2=e1000000-0000-0000-0000-000000000002
CC=e1000000-0000-0000-0000-00000000000c
Q1=e2000000-0000-0000-0000-000000000001; Q2=e2000000-0000-0000-0000-000000000002; Q3=e2000000-0000-0000-0000-000000000003
rel() { printf "('%s', '%s', '%s', '{\"files\":{\"index.html\":\"sha256:%s\"}}', 'ready')" "$1" "$2" "$3" "$3"; }
seed_union_prod() {
  local db="$1"
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$db" <<SQL
INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('$SCOPE', 'org-shared');
INSERT INTO public.account_users (id, sub, email, status) VALUES
  ('40000000-0000-0000-0000-000000000001', 'prod-user', 'prod@example.test', 'approved');
INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile) VALUES
  ('$P1', '$SCOPE', 'prod-user', 'p1', '{"v":"prod"}'),
  ('$CC', '$SCOPE', 'prod-user', 'c', '{"v":"prod"}');
INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state) VALUES
  $(rel e3000000-0000-0000-0000-000000000001 "$P1" dp1), $(rel e3000000-0000-0000-0000-00000000000c "$CC" dc);
INSERT INTO artifacts.blobs (storage_scope_id, digest, size) VALUES ('$SCOPE', 'dp1', 1), ('$SCOPE', 'dc', 1);
CREATE TABLE bulk (id int PRIMARY KEY, payload text);
INSERT INTO bulk VALUES (1, 'prod-v1');
SQL
}
apply_schema cat_pu1; seed_union_prod cat_pu1
pg_dump --format=custom --dbname=cat_pu1 --file="$work/prod-v1.dump"
# prod v2 is v1 evolved (same bytes for unchanged rows), not a fresh seed.
createdb --template=template0 cat_pu2
pg_restore --no-owner --no-privileges --exit-on-error --dbname=cat_pu2 "$work/prod-v1.dump"
psql -X -q -v ON_ERROR_STOP=1 --dbname=cat_pu2 <<SQL
INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile)
  VALUES ('$P2', '$SCOPE', 'prod-user', 'shared-binding', '{"v":"prod"}');
INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state) VALUES $(rel e3000000-0000-0000-0000-000000000002 "$P2" dp2);
INSERT INTO artifacts.blobs (storage_scope_id, digest, size) VALUES ('$SCOPE', 'dp2', 1);
UPDATE bulk SET payload = 'prod-v2';
SQL
pg_dump --format=custom --dbname=cat_pu2 --file="$work/prod-v2.dump"
createdb --template=template0 cat_dstu
pg_restore --no-owner --no-privileges --exit-on-error --dbname=cat_dstu "$work/prod-v1.dump"
psql -X -q -v ON_ERROR_STOP=1 --dbname=cat_dstu <<SQL
INSERT INTO public.account_users (id, sub, email, status) VALUES
  ('50000000-0000-0000-0000-000000000001', 'pre-user', 'pre@example.test', 'approved');
INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile) VALUES
  ('$Q1', '$SCOPE', 'pre-user', 'q1', '{"v":"pre"}'),
  ('$Q2', '$SCOPE', 'pre-user', 'q2', '{"v":"pre"}'),
  ('$Q3', '$SCOPE', 'prod-user', 'shared-binding', '{"v":"pre"}');
UPDATE artifacts.artifacts SET profile = '{"v":"preprod-edit"}' WHERE id = '$CC';
INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state) VALUES
  $(rel e4000000-0000-0000-0000-000000000001 "$Q1" dq1), $(rel e4000000-0000-0000-0000-000000000002 "$Q2" dq2),
  $(rel e4000000-0000-0000-0000-000000000003 "$Q3" dq3), $(rel e4000000-0000-0000-0000-00000000000c "$CC" dcq);
INSERT INTO artifacts.blobs (storage_scope_id, digest, size) VALUES
  ('$SCOPE', 'dq1', 1), ('$SCOPE', 'dq2', 1), ('$SCOPE', 'dq3', 1), ('$SCOPE', 'dcq', 1);
SQL
pg_dump --format=custom --dbname=cat_dstu --file="$work/preprod-live.dump"
if ! restore_with_catalogue cat_dstu "$work/prod-v2.dump" "$work/cat-union" > "$work/restore-union.out" 2>&1; then
  cat "$work/restore-union.out"; fail 'union restore refused'
fi
[[ $(q cat_dstu 'SELECT payload FROM bulk') == prod-v2 ]] || fail 'union: prod data not restored'
[[ $(q cat_dstu 'SELECT string_agg(id::text, $$ $$ ORDER BY id) FROM artifacts.artifacts') == "$P1 $P2 $CC $Q1 $Q2" ]] \
  || fail "union: artifact set $(q cat_dstu 'SELECT string_agg(id::text, $$ $$ ORDER BY id) FROM artifacts.artifacts')"
[[ $(q cat_dstu "SELECT profile->>'v' FROM artifacts.artifacts WHERE id = '$CC'") == prod ]] || fail 'union: id collision not won by prod'
[[ $(q cat_dstu "SELECT id::text FROM artifacts.artifacts WHERE binding_name = 'shared-binding'") == "$P2" ]] || fail 'union: slug collision not won by prod'
[[ $(q cat_dstu "SELECT artifact_id::text FROM artifacts.releases WHERE id = 'e4000000-0000-0000-0000-00000000000c'") == "$CC" ]] \
  || fail 'union: preprod release under a prod artifact lost'
[[ $(q cat_dstu 'SELECT count(*) FROM artifacts.releases') == 6 ]] || fail 'union: release count'
[[ $(q cat_dstu 'SELECT count(*) FROM artifacts.releases r WHERE NOT EXISTS (SELECT 1 FROM artifacts.blobs b WHERE b.digest = r.manifest_digest)') == 0 ]] \
  || fail 'union: a release lacks its blob registry row'
journal=$work/cat-union/export/conflicts.tsv
[[ $(awk -F'\t' '$1 == "artifacts" && $2 == "collision:prod-wins"' "$journal" | wc -l) == 2 ]] || { cat "$journal"; fail 'union: collisions not journaled'; }
grep -q "$CC.*preprod-edit" "$journal" || fail 'union: preprod version of the id collision not journaled'
grep -q "\"id\":\"$Q3\"" "$journal" || fail 'union: slug collision row not journaled'
[[ $(awk -F'\t' '$1 == "releases" && $2 == "orphan:artifacts.artifacts"' "$journal" | wc -l) == 1 ]] || { cat "$journal"; fail 'union: orphan release not journaled'; }
grep -qx $'artifacts\t5\t1\t2\t2\t0' "$work/cat-union/export/union.tsv" || { cat "$work/cat-union/export/union.tsv"; fail 'union: accounting'; }
PGDATABASE=cat_dstu bash "$CATALOGUE" verify --in-dir "$work/cat-union/export" --union >/dev/null || fail 'union: verify refused'
if PGDATABASE=cat_dstu bash "$CATALOGUE" verify --in-dir "$work/cat-union/export" >/dev/null 2>&1; then fail 'union: byte verify should differ once prod rows exist'; fi
# Repeated restore of the same prod snapshot: no duplicate, no new conflict.
restore_with_catalogue cat_dstu "$work/prod-v2.dump" "$work/cat-union2" > "$work/restore-union2.out" 2>&1 || { cat "$work/restore-union2.out"; fail 'second union restore refused'; }
[[ $(q cat_dstu 'SELECT count(*) FROM artifacts.artifacts') == 5 ]] || fail 'union: repeated restore changed the artifact count'
[[ $(q cat_dstu 'SELECT count(*) FROM artifacts.releases') == 6 ]] || fail 'union: repeated restore changed the release count'
[[ ! -s "$work/cat-union2/export/conflicts.tsv" ]] || { cat "$work/cat-union2/export/conflicts.tsv"; fail 'union: repeated restore journaled conflicts'; }
grep -qx $'artifacts\t5\t3\t2\t0\t0' "$work/cat-union2/export/union.tsv" || { cat "$work/cat-union2/export/union.tsv"; fail 'union: repeated accounting'; }
[[ $(q cat_pu2 'SELECT count(*) FROM artifacts.artifacts') == 3 ]] || fail 'union: prod origin mutated'
printf 'Union green: 3 prod + 2 preprod-own artifacts, 2 collisions prod-wins journaled, 1 orphan journaled, repeat idempotent\n'

# ── Job wiring: stash in the restore Job, union import after the migrations ──
# Same preprod state as above; CATALOGUE_STASH=1 is what the restore Job sets.
stash_restore() {
  local db="$1" dump="$2" catdir="$3" target="${4:-}" live="${5:-}" toc
  toc=$(pg_restore --list "$dump" | grep -c '^[0-9]' || true)
  PGDATABASE=$db EXPECTED_DATABASE=$db TARGET_DB="$target" LIVE_DB="$live" RESTORE_DUMP="$dump" EXPECTED_TOC_ENTRIES=$toc \
    RESTORE_ASSERT_DB=0 DUMP_DATABASE=x CATALOGUE_DIR="$catdir" CATALOGUE_SCRIPT="$CATALOGUE" CATALOGUE_STASH=1 CATALOGUE_STASH_TAG="${STASH_TAG:-run1}" bash "$RESTORE"
}
createdb --template=template0 cat_dsts
pg_restore --no-owner --no-privileges --exit-on-error --dbname=cat_dsts "$work/preprod-live.dump"
stash_restore cat_dsts "$work/prod-v2.dump" "$work/stash1" > "$work/stash1.out" 2>&1 || { cat "$work/stash1.out"; fail 'stash restore refused'; }
[[ $(q cat_dsts 'SELECT count(*) FROM artifacts.artifacts') == 3 ]] || fail 'stash: restore must leave the prod catalogue only until the import'
PGDATABASE=cat_dsts bash "$CATALOGUE" stash-exists || fail 'stash: missing after restore'
gen1=$(q cat_dsts "SELECT convert_from(decode(b64, 'base64'), 'UTF8') FROM catalogue_stash.files WHERE path = 'manifest.json'" | grep -o '"generation":"[^"]*"')
# Relaunch after the replay: the stash (pre-restore preprod state) is reused, never re-exported from prod rows.
stash_restore cat_dsts "$work/prod-v2.dump" "$work/stash2" > "$work/stash2.out" 2>&1 || { cat "$work/stash2.out"; fail 'stash relaunch refused'; }
grep -q 'stash of this run already present' "$work/stash2.out" || fail 'stash: relaunch did not reuse the stash'
[[ $(q cat_dsts "SELECT convert_from(decode(b64, 'base64'), 'UTF8') FROM catalogue_stash.files WHERE path = 'manifest.json'" | grep -o '"generation":"[^"]*"') == "$gen1" ]] || fail 'stash: relaunch replaced the stash'
# Simulated ddl of a newer release: one more migration and a defaulted column.
q cat_dsts "ALTER TABLE artifacts.artifacts ADD COLUMN union_next_release TEXT NOT NULL DEFAULT 'next'" >/dev/null
q cat_dsts "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('simulated-next-release', now())" >/dev/null
PGDATABASE=cat_dsts bash "$CATALOGUE" import-stash --work "$work/stash-import" > "$work/stash-import.out" 2>&1 || { cat "$work/stash-import.out"; fail 'stash import refused'; }
[[ $(q cat_dsts 'SELECT string_agg(id::text, $$ $$ ORDER BY id) FROM artifacts.artifacts') == "$P1 $P2 $CC $Q1 $Q2" ]] || fail 'stash: union artifact set'
[[ $(q cat_dsts "SELECT count(*) FROM catalogue_journal.conflicts WHERE tbl = 'artifacts' AND reason = 'collision:prod-wins'") == 2 ]] || fail 'stash: collisions not journaled in the database'
[[ $(q cat_dsts "SELECT count(*) FROM catalogue_journal.conflicts WHERE reason LIKE 'orphan:%'") == 1 ]] || fail 'stash: orphan not journaled in the database'
[[ $(q cat_dsts "SELECT inserted FROM catalogue_journal.imports WHERE tbl = 'artifacts'") == 2 ]] || fail 'stash: import summary missing'
if PGDATABASE=cat_dsts bash "$CATALOGUE" stash-exists; then fail 'stash: not dropped after import'; fi
PGDATABASE=cat_dsts bash "$CATALOGUE" import-stash --work "$work/stash-import2" >/dev/null 2>&1 || fail 'stash: second import must be a no-op'
[[ $(q cat_dsts 'SELECT count(*) FROM artifacts.artifacts') == 5 ]] || fail 'stash: no-op import changed the catalogue'
# The next restore keeps the conflict journal (schema reset spares it).
STASH_TAG=run2 stash_restore cat_dsts "$work/prod-v2.dump" "$work/stash3" > "$work/stash3.out" 2>&1 || { cat "$work/stash3.out"; fail 'stash restore 2 refused'; }
[[ $(q cat_dsts 'SELECT count(*) FROM catalogue_journal.conflicts') == 3 ]] || fail 'stash: journal lost by the next restore'
# The export carried the newer schema: the migrations run again before the import.
q cat_dsts "ALTER TABLE artifacts.artifacts ADD COLUMN union_next_release TEXT NOT NULL DEFAULT 'next'" >/dev/null
q cat_dsts "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('simulated-next-release', now())" >/dev/null
PGDATABASE=cat_dsts bash "$CATALOGUE" import-stash --work "$work/stash-import3" >/dev/null 2>&1 || fail 'stash: import after the second restore refused'
[[ $(q cat_dsts 'SELECT count(*) FROM artifacts.artifacts') == 5 ]] || fail 'stash: second restore lost the union'
[[ $(q cat_dsts 'SELECT count(*) FROM catalogue_journal.conflicts') == 3 ]] || fail 'stash: conflict-free import added journal lines'
# Prepared database: export from LIVE_DB only, stash in the candidate.
createdb --template=template0 cat_preps
if STASH_TAG=runP stash_restore cat_preps "$work/prod-v2.dump" "$work/stashp0" cat_preps "" >/dev/null 2>&1; then fail 'stash: prepared restore without LIVE_DB accepted'; fi
if STASH_TAG=runP stash_restore cat_preps "$work/prod-v2.dump" "$work/stashp0" cat_preps cat_preps >/dev/null 2>&1; then fail 'stash: prepared restore from the candidate accepted'; fi
STASH_TAG=runP stash_restore cat_preps "$work/prod-v2.dump" "$work/stashp" cat_preps cat_dsts > "$work/stashp.out" 2>&1 || { cat "$work/stashp.out"; fail 'stash: prepared restore refused'; }
[[ $(q cat_dsts 'SELECT count(*) FROM artifacts.artifacts') == 5 ]] || fail 'stash: live source mutated by the prepared restore'
q cat_preps "ALTER TABLE artifacts.artifacts ADD COLUMN union_next_release TEXT NOT NULL DEFAULT 'next'" >/dev/null
q cat_preps "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('simulated-next-release', now())" >/dev/null
PGDATABASE=cat_preps bash "$CATALOGUE" import-stash --work "$work/stashp-import" > "$work/stashp-import.out" 2>&1 || { cat "$work/stashp-import.out"; fail 'stash: prepared import refused'; }
[[ $(q cat_preps 'SELECT count(*) FROM artifacts.artifacts') == 5 ]] || fail 'stash: prepared union artifact count'
printf 'Stash wiring green: restore stashes, relaunch reuses, union after a newer schema, journal kept, prepared exports from live only\n'

# ── Scope rewrite + blob check (owner decision 2026-11-15) ───────────────────
# Prod rows (scope radar-immobilier) move to the preprod scope before the union;
# a preprod row bound to the same slug then collides and prod wins (journaled).
# Scope configuration (storage_scopes, host_policy) stays the preprod one.
PS=radar-immobilier; QS=radar-immobilier-preprod
HA=$(printf 'a%.0s' $(seq 64)); HB=$(printf 'b%.0s' $(seq 64))
PA=f1000000-0000-0000-0000-00000000000a; QA=f2000000-0000-0000-0000-00000000000a; QB=f2000000-0000-0000-0000-00000000000b
seed_scope_prod() {
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$1" <<SQL
INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('$PS', 'org-prod');
INSERT INTO artifacts.host_policy (storage_scope_id, revision) VALUES ('$PS', 'prod-rev');
INSERT INTO public.account_users (id, sub, email, status) VALUES ('60000000-0000-0000-0000-000000000001', 'prod-user', 'p@example.test', 'approved');
INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile) VALUES ('$PA', '$PS', 'prod-user', 'shared', '{"v":"prod"}');
INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state)
  VALUES ('f3000000-0000-0000-0000-00000000000a', '$PA', 'ma', '{"files":{"index.html":"sha256:$HA"}}', 'ready');
INSERT INTO artifacts.artifact_current (artifact_id, release_id) VALUES ('$PA', 'f3000000-0000-0000-0000-00000000000a');
INSERT INTO artifacts.blobs (storage_scope_id, digest, size) VALUES ('$PS', 'sha256:$HA', 6);
SQL
}
apply_schema cat_sc_src
psql -X -q -v ON_ERROR_STOP=1 --dbname=cat_sc_src <<SQL
INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('$QS', '$QS');
INSERT INTO artifacts.host_policy (storage_scope_id, revision) VALUES ('$QS', 'pre-rev');
INSERT INTO public.account_users (id, sub, email, status) VALUES ('60000000-0000-0000-0000-000000000001', 'prod-user', 'p@example.test', 'approved');
INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile) VALUES
  ('$QA', '$QS', 'prod-user', 'shared', '{"v":"pre"}'), ('$QB', '$QS', 'prod-user', 'qb', '{"v":"pre"}');
INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state)
  VALUES ('f4000000-0000-0000-0000-00000000000b', '$QB', 'mb', '{"files":{"index.html":"sha256:$HB"}}', 'ready');
INSERT INTO artifacts.blobs (storage_scope_id, digest, size) VALUES ('$QS', 'sha256:$HB', 7);
SQL
PGDATABASE=cat_sc_src bash "$CATALOGUE" export --out-dir "$work/sc-export" >/dev/null || fail 'scope: export refused'
fk_count() { q "$1" "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = 'artifacts'"; }
# Missing prod blob in the preprod bucket: refused before any preprod row is imported.
apply_schema cat_sc_miss; seed_scope_prod cat_sc_miss
PGDATABASE=cat_sc_miss bash "$CATALOGUE" stash --in-dir "$work/sc-export" --tag scope-run >/dev/null || fail 'scope: stash refused'
printf '%s\n' "$HB" > "$work/keys-missing.txt"
if PGDATABASE=cat_sc_miss bash "$CATALOGUE" import-stash --work "$work/sc-miss" --rewrite-from "$PS" --rewrite-to "$QS" --blob-keys "$work/keys-missing.txt" > "$work/sc-miss.out" 2>&1; then
  fail 'scope: missing blob accepted'
fi
grep -q 'blob-check: 1 blob' "$work/sc-miss.out" || { cat "$work/sc-miss.out"; fail 'scope: refusal is not the blob check'; }
[[ $(q cat_sc_miss "SELECT count(*) FROM artifacts.artifacts WHERE id IN ('$QA', '$QB')") == 0 ]] || fail 'scope: preprod rows imported despite the missing blob'
PGDATABASE=cat_sc_miss bash "$CATALOGUE" stash-exists || fail 'scope: stash lost by the refusal'
[[ $(q cat_sc_miss "SELECT count(*) FROM artifacts.artifacts WHERE storage_scope_id = '$PS'") == 1 ]] || fail 'scope: rewrite committed although a blob is missing'
[[ $(q cat_sc_miss "SELECT count(*) FROM artifacts.storage_scopes WHERE id = '$PS'") == 1 ]] || fail 'scope: prod scope row lost by the refusal'
# All blobs present: rewrite, union, final check.
apply_schema cat_sc; seed_scope_prod cat_sc
fks=$(fk_count cat_sc)
PGDATABASE=cat_sc bash "$CATALOGUE" stash --in-dir "$work/sc-export" --tag scope-run >/dev/null || fail 'scope: stash refused'
printf '%s\n%s\n' "$HA" "$HB" > "$work/keys-all.txt"
PGDATABASE=cat_sc bash "$CATALOGUE" import-stash --work "$work/sc" --rewrite-from "$PS" --rewrite-to "$QS" --blob-keys "$work/keys-all.txt" > "$work/sc.out" 2>&1 \
  || { cat "$work/sc.out"; fail 'scope: import with rewrite refused'; }
[[ $(q cat_sc "SELECT string_agg(DISTINCT storage_scope_id, ',') FROM (SELECT storage_scope_id FROM artifacts.artifacts UNION ALL SELECT storage_scope_id FROM artifacts.blobs UNION ALL SELECT storage_scope_id FROM artifacts.host_policy) s") == "$QS" ]] || fail 'scope: rows left under the prod scope'
[[ $(q cat_sc "SELECT id || '|' || org_id FROM artifacts.storage_scopes") == "$QS|$QS" ]] || fail 'scope: storage scope is not the preprod one'
[[ $(q cat_sc "SELECT revision FROM artifacts.host_policy") == pre-rev ]] || fail 'scope: preprod host policy lost'
[[ $(q cat_sc "SELECT string_agg(id::text, ' ' ORDER BY id) FROM artifacts.artifacts") == "$PA $QB" ]] || fail 'scope: union artifact set'
[[ $(q cat_sc "SELECT count(*) FROM catalogue_journal.conflicts WHERE tbl = 'artifacts' AND payload LIKE '%$QA%'") == 1 ]] || fail 'scope: slug collision under the preprod scope not journaled'
[[ $(fk_count cat_sc) == "$fks" ]] || fail 'scope: foreign keys not restored'
[[ $(q cat_sc "SELECT count(*) FROM artifacts.blobs WHERE digest = 'sha256:$HA'") == 1 ]] || fail 'scope: prod blob registry row lost'
if PGDATABASE=cat_sc bash "$CATALOGUE" stash-exists; then fail 'scope: stash not dropped'; fi
# Relaunch: rewrite and blob check are idempotent.
PGDATABASE=cat_sc bash "$CATALOGUE" import-stash --work "$work/sc2" --rewrite-from "$PS" --rewrite-to "$QS" --blob-keys "$work/keys-all.txt" >/dev/null 2>&1 || fail 'scope: relaunch refused'
printf 'Scope rewrite green: prod rows under the preprod scope, preprod scope config kept, slug collision journaled, blob check refuses a missing blob\n'

# ── Stale stash of another run (review 2026-11-15): never imported alone ─────
# Run 1 stashes and replays prod, its catalogue import never completes, the
# site reopens and preprod work continues (Q9). Run 2 must keep run 1's
# generation AND export the live database again: both are imported, newest
# first, and nothing created in between is lost.
Q9=e2000000-0000-0000-0000-000000000009
createdb --template=template0 cat_stale
pg_restore --no-owner --no-privileges --exit-on-error --dbname=cat_stale "$work/preprod-live.dump"
STASH_TAG=run1 stash_restore cat_stale "$work/prod-v2.dump" "$work/stale1" > "$work/stale1.out" 2>&1 || { cat "$work/stale1.out"; fail 'stale: run 1 refused'; }
q cat_stale "INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile) VALUES ('$Q9', '$SCOPE', 'pre-user', 'q9', '{\"v\":\"after-reopen\"}')" >/dev/null
STASH_TAG=run2 stash_restore cat_stale "$work/prod-v2.dump" "$work/stale2" > "$work/stale2.out" 2>&1 || { cat "$work/stale2.out"; fail 'stale: run 2 refused'; }
grep -q 'pending catalogue stash from another run (run1)' "$work/stale2.out" || { cat "$work/stale2.out"; fail 'stale: stash of another run silently reused'; }
[[ $(q cat_stale "SELECT string_agg(tag, ',' ORDER BY seq) FROM catalogue_stash.meta") == run1,run2 ]] || fail 'stale: generations not kept newest last'
[[ $(q cat_stale "SELECT count(*) FROM artifacts.artifacts WHERE id = '$Q9'") == 0 ]] || fail 'stale: run 2 did not replay prod'
PGDATABASE=cat_stale bash "$CATALOGUE" import-stash --work "$work/stale-import" > "$work/stale-import.out" 2>&1 || { cat "$work/stale-import.out"; fail 'stale: import refused'; }
[[ $(q cat_stale "SELECT count(*) FROM artifacts.artifacts WHERE id IN ('$Q1', '$Q2', '$Q9')") == 3 ]] || fail 'stale: preprod artifacts lost across runs'
[[ $(q cat_stale "SELECT count(DISTINCT generation) FROM catalogue_journal.imports") == 2 ]] || fail 'stale: both generations not imported'
if PGDATABASE=cat_stale bash "$CATALOGUE" stash-exists; then fail 'stale: stash not dropped'; fi
# Same run relaunched after its replay reuses its own generation only.
STASH_TAG=run3 stash_restore cat_stale "$work/prod-v2.dump" "$work/stale3" >/dev/null 2>&1 || fail 'stale: run 3 refused'
STASH_TAG=run3 stash_restore cat_stale "$work/prod-v2.dump" "$work/stale3b" > "$work/stale3b.out" 2>&1 || fail 'stale: run 3 relaunch refused'
grep -q 'stash of this run already present' "$work/stale3b.out" || fail 'stale: same-run relaunch did not reuse its stash'
[[ $(q cat_stale "SELECT count(*) FROM catalogue_stash.meta") == 1 ]] || fail 'stale: same-run relaunch added a generation'
printf 'Stale stash green: another run never imported alone, both generations imported, no artifact lost\n'

# ── Schema gate refuses before loading (review 2026-11-15) ────────────────────
createdb --template=template0 cat_gate1; createdb --template=template0 cat_gate2
for db in cat_gate1 cat_gate2; do pg_restore --no-owner --no-privileges --exit-on-error --dbname=$db "$work/prod-v2.dump"; done
PGDATABASE=cat_stale bash "$CATALOGUE" export --out-dir "$work/gate-export" >/dev/null || fail 'gate: export refused'
q cat_gate1 "ALTER TABLE artifacts.artifacts ADD COLUMN must_fill TEXT" >/dev/null
q cat_gate1 "UPDATE artifacts.artifacts SET must_fill = 'x'" >/dev/null
q cat_gate1 "ALTER TABLE artifacts.artifacts ALTER COLUMN must_fill SET NOT NULL" >/dev/null
q cat_gate1 "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('simulated-not-null', now())" >/dev/null
if PGDATABASE=cat_gate1 bash "$CATALOGUE" import --in-dir "$work/gate-export" > "$work/gate1.out" 2>&1; then fail 'gate: NOT NULL without default accepted'; fi
grep -q 'NOT NULL without default absent from the export on artifacts' "$work/gate1.out" || { cat "$work/gate1.out"; fail 'gate: NOT NULL refusal not raised by the gate'; }
q cat_gate2 "ALTER TABLE artifacts.artifacts ALTER COLUMN binding_name TYPE varchar(200)" >/dev/null
if PGDATABASE=cat_gate2 bash "$CATALOGUE" import --in-dir "$work/gate-export" > "$work/gate2.out" 2>&1; then fail 'gate: type change accepted'; fi
grep -q 'column type mismatch on artifacts (binding_name)' "$work/gate2.out" || { cat "$work/gate2.out"; fail 'gate: type refusal not raised by the gate'; }
for db in cat_gate1 cat_gate2; do [[ $(q $db "SELECT count(*) FROM artifacts.artifacts") == 3 ]] || fail "gate: $db catalogue touched by a refused import"; done
printf 'Schema gate green: NOT NULL without default and type change refused before any load\n'

# ── Edited migration (operation e776ee55, 2026-11-16) ─────────────────────────
# A migration file edited after it was applied gives preprod and prod different
# hashes for the same migration (0038). Same schema shape: accepted, the drift
# journaled. A real shape gap with a differing journal: still refused.
createdb --template=template0 cat_hash; createdb --template=template0 cat_hash2
for db in cat_hash cat_hash2; do
  pg_restore --no-owner --no-privileges --exit-on-error --dbname=$db "$work/prod-v2.dump"
  q $db "UPDATE drizzle.__drizzle_migrations SET hash = 'edited-after-apply' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)" >/dev/null
done
PGDATABASE=cat_hash bash "$CATALOGUE" import --in-dir "$work/gate-export" > "$work/hash.out" 2>&1 || { cat "$work/hash.out"; fail 'hash: edited migration with the same shape refused'; }
grep -q 'migration journal differs from the export (export-only 1, target-only 1): schema shape gate applies' "$work/hash.out" || { cat "$work/hash.out"; fail 'hash: drift not reported'; }
[[ $(q cat_hash "SELECT target_only FROM catalogue_journal.schema_drift") == edited-after-apply ]] || fail 'hash: drift not journaled'
q cat_hash2 "ALTER TABLE artifacts.artifacts DROP COLUMN metadata" >/dev/null
if PGDATABASE=cat_hash2 bash "$CATALOGUE" import --in-dir "$work/gate-export" > "$work/hash2.out" 2>&1; then fail 'hash: shape gap accepted with a differing journal'; fi
grep -q 'export columns missing on artifacts (metadata)' "$work/hash2.out" || { cat "$work/hash2.out"; fail 'hash: shape refusal not raised'; }
[[ $(q cat_hash2 "SELECT count(*) FROM artifacts.artifacts") == 3 ]] || fail 'hash: refused import touched the catalogue'
printf 'Edited migration green: same shape accepted and journaled, real shape gap refused\n'

# ── Full schema (every migration): scope rewrite vs append-only tables ───────
# Regression of operation e776ee55 (2026-11-16): the 0036 statement-level
# append-only guards fired on an UPDATE of an EMPTY git_binding_events and the
# rewrite failed with psql exit 3, cause visible only in the server log.
apply_full_schema() {
  local db="$1" tag hash i=0
  createdb --template=template0 "$db"
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$db" -c 'CREATE SCHEMA IF NOT EXISTS drizzle' \
    -c 'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at timestamptz NOT NULL)'
  for tag in $(grep -o '"tag": *"[^"]*"' "$MIG_DIR/meta/_journal.json" | sed 's/.*"\([^"]*\)"$/\1/'); do
    i=$((i + 1))
    psql -X -q -v ON_ERROR_STOP=1 --single-transaction --dbname="$db" -f "$MIG_DIR/$tag.sql" >/dev/null 2>&1 \
      || { psql -X -v ON_ERROR_STOP=1 --single-transaction --dbname="$db" -f "$MIG_DIR/$tag.sql" 2>&1 | tail -n 5; fail "full schema: migration $tag refused"; }
    hash=$(sha256sum "$MIG_DIR/$tag.sql" | awk '{print $1}')
    q "$db" "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$hash', to_timestamp(1792000001 + $i))" >/dev/null
  done
}
FS=radar-immobilier; FT=radar-immobilier-preprod; FA=f9000000-0000-0000-0000-00000000000a
seed_full_prod() {
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$1" <<SQL
INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('$FS', 'org-prod');
INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile) VALUES ('$FA', '$FS', 'prod-user', 'full', '{}');
SQL
}
guards() { q "$1" "SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'artifacts' AND c.relname IN ('git_binding_events', 'git_release_index') AND NOT g.tgisinternal AND g.tgenabled = 'O'"; }
apply_full_schema cat_full_ok
[[ $(guards cat_full_ok) == 2 ]] || fail 'full schema: append-only guards of 0036 absent'
# Case 1+3: append-only tables without prod-scope rows are not touched; an
# ordinary table holding prod-scope rows is updated.
seed_full_prod cat_full_ok
PGDATABASE=cat_full_ok bash "$CATALOGUE" import-stash --work "$work/full-ok" --rewrite-from "$FS" --rewrite-to "$FT" > "$work/full-ok.out" 2>&1 \
  || { cat "$work/full-ok.out"; fail 'full schema: rewrite refused with empty append-only tables'; }
[[ $(q cat_full_ok "SELECT storage_scope_id FROM artifacts.artifacts WHERE id = '$FA'") == "$FT" ]] || fail 'full schema: ordinary table not rewritten'
[[ $(q cat_full_ok "SELECT count(*) FROM artifacts.storage_scopes WHERE id = '$FS'") == 0 ]] || fail 'full schema: prod scope row left'
[[ $(guards cat_full_ok) == 2 ]] || fail 'full schema: append-only guards disabled by the rewrite'
[[ $(q cat_full_ok "SELECT to_regclass('catalogue_journal.failures') IS NULL") == t ]] || fail 'full schema: failure journaled on success'
[[ $(q cat_full_ok "SELECT tbl || ':' || action || ':' || row_count FROM catalogue_journal.rewrites WHERE tbl = 'artifacts'") == artifacts:updated:1 ]] || fail 'full schema: rewrite not journaled'
[[ $(q cat_full_ok "SELECT count(*) FROM pg_extension WHERE extname = 'pgcrypto'") == 0 ]] || fail 'full schema: pgcrypto present, unlike the live database'
# Case 2: an append-only table holding prod-scope rows refuses, writes nothing,
# and the cause lands in catalogue_journal.failures (no server log needed).
apply_full_schema cat_full_ro; seed_full_prod cat_full_ro
q cat_full_ro "INSERT INTO artifacts.git_binding_events (artifact_id, storage_scope_id, actor_id, action, created_at) VALUES ('$FA', '$FS', 'prod-user', 'attach', now())" >/dev/null
if PGDATABASE=cat_full_ro bash "$CATALOGUE" import-stash --work "$work/full-ro" --rewrite-from "$FS" --rewrite-to "$FT" > "$work/full-ro.out" 2>&1; then
  fail 'full schema: append-only rows rewritten'
fi
grep -q 'append-only table git_binding_events holds 1 prod-scope rows: decision required' "$work/full-ro.out" || { cat "$work/full-ro.out"; fail 'full schema: refusal not explicit'; }
[[ $(q cat_full_ro "SELECT step FROM catalogue_journal.failures") == rewrite-scope ]] || fail 'full schema: failure step not journaled'
q cat_full_ro "SELECT cause FROM catalogue_journal.failures" | grep -q 'append-only table git_binding_events holds 1 prod-scope rows: decision required' || fail 'full schema: failure cause not journaled'
[[ $(q cat_full_ro "SELECT storage_scope_id FROM artifacts.artifacts WHERE id = '$FA'") == "$FS" ]] || fail 'full schema: refused rewrite wrote an ordinary table'
[[ $(q cat_full_ro "SELECT storage_scope_id FROM artifacts.git_binding_events") == "$FS" ]] || fail 'full schema: refused rewrite touched the audit row'
[[ $(q cat_full_ro "SELECT count(*) FROM artifacts.storage_scopes WHERE id = '$FS'") == 1 ]] || fail 'full schema: refused rewrite lost the prod scope'
[[ $(guards cat_full_ro) == 2 ]] || fail 'full schema: append-only guards disabled by the refusal'
printf 'Full schema green: empty append-only tables untouched, ordinary rows rewritten, append-only prod rows refused and journaled\n'
# Full schema, whole import-stash path: the preprod stash holds an artifact and
# a row of the append-only git_binding_events; prod holds a scope policy. The
# union imports both preprod rows (INSERT only), the guards stay enabled, the
# deleted prod policy row is journaled, no failure is recorded, no pgcrypto.
FQ=f9000000-0000-0000-0000-00000000000b
apply_full_schema cat_full_src
psql -X -q -v ON_ERROR_STOP=1 --dbname=cat_full_src <<SQL
INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('$FT', '$FT');
INSERT INTO public.account_users (id, sub, status) VALUES ('61000000-0000-0000-0000-000000000001', 'pre-user', 'approved');
INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile) VALUES ('$FQ', '$FT', 'pre-user', 'full-pre', '{}');
INSERT INTO artifacts.git_binding_events (artifact_id, storage_scope_id, actor_id, action, created_at) VALUES ('$FQ', '$FT', 'pre-user', 'attach', now());
SQL
PGDATABASE=cat_full_src bash "$CATALOGUE" export --out-dir "$work/full-export" >/dev/null || fail 'full schema: preprod export refused (identity columns of 0032+)'
apply_full_schema cat_full_un; seed_full_prod cat_full_un
q cat_full_un "INSERT INTO artifacts.host_policy (storage_scope_id, revision) VALUES ('$FS', 'prod-rev')" >/dev/null
PGDATABASE=cat_full_un bash "$CATALOGUE" stash --in-dir "$work/full-export" --tag full-run >/dev/null || fail 'full schema: stash refused'
PGDATABASE=cat_full_un bash "$CATALOGUE" import-stash --work "$work/full-un" --rewrite-from "$FS" --rewrite-to "$FT" > "$work/full-un.out" 2>&1 \
  || { cat "$work/full-un.out"; fail 'full schema: union import refused'; }
[[ $(q cat_full_un "SELECT string_agg(id::text, ' ' ORDER BY id) FROM artifacts.artifacts") == "$FA $FQ" ]] || fail 'full schema: union artifact set'
[[ $(q cat_full_un "SELECT count(*) || ':' || min(storage_scope_id) FROM artifacts.git_binding_events WHERE artifact_id = '$FQ'") == "1:$FT" ]] || fail 'full schema: append-only preprod row not imported'
[[ $(guards cat_full_un) == 2 ]] || fail 'full schema: guards not re-enabled after the union load'
[[ $(q cat_full_un "SELECT row_count FROM catalogue_journal.rewrites WHERE tbl = 'host_policy' AND action LIKE 'deleted%'") == 1 ]] || fail 'full schema: prod policy deletion not journaled'
grep -q 'deleted 1 prod-scope row(s) from host_policy' "$work/full-un.out" || fail 'full schema: prod policy deletion not reported'
[[ $(q cat_full_un "SELECT to_regclass('catalogue_journal.failures') IS NULL") == t ]] || fail 'full schema: failure journaled on a clean union'
[[ $(q cat_full_un "SELECT count(*) FROM pg_extension WHERE extname = 'pgcrypto'") == 0 ]] || fail 'full schema: pgcrypto present'
if PGDATABASE=cat_full_un bash "$CATALOGUE" stash-exists; then fail 'full schema: stash not dropped'; fi
printf 'Full schema union green: append-only preprod row imported, guards kept, policy deletion journaled, no pgcrypto\n'
printf 'Catalogue preservation round-trip green: witness byte-identical, identities remapped, prod untouched\n'
