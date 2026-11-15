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
  for db in cat_src cat_prodd cat_prodrej cat_dst cat_dst_map cat_dst2 cat_dst29 cat_src29 cat_prep tmp-prod-x; do
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
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$db" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto' \
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

printf 'Catalogue preservation round-trip green: witness byte-identical, identities remapped, prod untouched\n'
