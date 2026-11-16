# Preprod artifact catalogue preservation (D2 = C).
#
# Consistent export of the preprod-only artifact catalogue (schema artifacts.*,
# rows only — blobs stay in S3 OVH BHS) and controlled re-import after a
# prod-to-preprod restore, before reopening. The same mechanism serves the
# blue/green cutover (#956) and the PG18 upgrade: prepare the candidate from
# the prod dump, then import the preprod catalogue.
#
# Stack: shell plus the native database client tools only (pg_dump,
# pg_restore, psql, sha256sum), no extra runtimes or query tools, no new
# container image: this script runs wherever atomic-restore.sh runs. It
# never reads shell environment files and never touches the cluster.
#
# Usage:
#   artifacts-catalogue.sh gate   --target-db NAME [--max-bytes N] [--max-rows N] [--map FILE]
#   artifacts-catalogue.sh export --out-dir DIR [--scope SCOPE]
#   artifacts-catalogue.sh import --in-dir DIR [--map FILE] [--report FILE] [--allow-same-db]
#   artifacts-catalogue.sh verify --in-dir DIR [--union]
#   artifacts-catalogue.sh archive --in-dir DIR --bucket NAME --prefix PATH --endpoint-url URL [--s5cmd BIN]
#   artifacts-catalogue.sh manifest-check --in-dir DIR
#   artifacts-catalogue.sh map-check --map FILE --subjects FILE
#   artifacts-catalogue.sh stash --in-dir DIR --tag TAG | stash-exists | stash-tag | stash-drop
#   artifacts-catalogue.sh stash-carry --from-db NAME --work DIR
#   artifacts-catalogue.sh import-stash --work DIR [--map FILE] [--rewrite-from S --rewrite-to T [--blob-keys FILE]]
#   artifacts-catalogue.sh rewrite-scope --from S --to T [--export DIR] [--blob-keys FILE]
#   artifacts-catalogue.sh blob-check --scope T --keys FILE
#
# Connection through libpq PG* env (PGHOST, PGUSER, PGPASSWORD, PGDATABASE,
# PGPORT). Exit 0 on success (gate: GO), 1 on refusal/failure (gate: NO-GO).
set -euo pipefail

CATALOGUE_FORMAT_VERSION=1
# Tables that are deliberately NOT transferred: live tickets, staging and
# in-flight or observational state. Justification is recorded in the manifest.
CATALOGUE_EPHEMERAL_TABLES="reader_tickets uploads object_intents host_failures host_actor_rate"
# Subjects referenced by the durable catalogue (TEXT columns, no FK out of
# artifacts.*): owner_id, principal_id (ACL), actor_id (quotas, confirmations).
CATALOGUE_SUBJECT_COLUMNS="artifacts.artifacts|owner_id artifacts.artifact_access|principal_id artifacts.host_actor_quotas|actor_id artifacts.delete_confirmations|actor_id"

catalogue_fail() { printf '[catalogue] ERROR — %s\n' "$*" >&2; exit 1; }
catalogue_log() { printf '[catalogue] %s\n' "$*" >&2; }

# Destructive-path registry (L0 early gate). Every non-test executable in this
# repo that can drop schemas or databases must be listed here with its
# preservation contract. The hermetic test enforces registry completeness.
# Format: path|kind|contract
catalogue_destructive_paths() {
  printf '%s\n' \
    'deploy/cutover/atomic-restore.sh|drop-schema|CATALOGUE_DIR hook preserves and re-imports before reopen' \
    'deploy/cutover/artifacts-catalogue.sh|drop-schema|drops only its own catalogue_stash schema after a union import, never artifacts.*' \
    'deploy/cutover/database.cjs|drop-database|candidate-only reset, refuses live identity, caller re-imports catalogue' \
    'tools/make/base-api-ct8.mjs|drop-database|test-only CT8 helper, never on preprod data' \
    'tools/make/base-api-l5-ct8.mjs|drop-database|test-only CT8 helper, never on preprod data'
}

catalogue_psql() {
  psql -X --no-psqlrc -v ON_ERROR_STOP=1 --quiet "$@"
}

catalogue_current_db() {
  catalogue_psql -At -c 'SELECT current_database()'
}

# Refuse anything that looks like production. Preprod-only by construction.
catalogue_refuse_prod() {
  local db="$1"
  if printf '%s' "$db" | grep -Eiq '(^|[-_])prod([-_]|$)'; then
    catalogue_fail "refusing production database '$db'"
  fi
}

catalogue_durable_tables() {
  local exclude
  exclude=$(printf "('%s')" "$(printf '%s' "$CATALOGUE_EPHEMERAL_TABLES" | sed "s/ /','/g")")
  catalogue_psql -At -c "SELECT tablename FROM pg_tables WHERE schemaname = 'artifacts' AND tablename NOT IN $exclude ORDER BY 1"
}

catalogue_table_columns() {
  local table="$1"
  catalogue_psql -At -c "SELECT a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'artifacts' AND c.relname = '$table' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum"
}

catalogue_order_by() {
  local table="$1" n i out
  n=$(catalogue_table_columns "$table" | wc -l)
  out=""
  for ((i = 1; i <= n; i++)); do out="${out}${out:+,}$i"; done
  printf '%s' "$out"
}

catalogue_select_sql() {
  printf "SELECT * FROM artifacts.%s ORDER BY %s" "$1" "$(catalogue_order_by "$1")"
}

catalogue_copy_sql() {
  printf "COPY (%s) TO STDOUT" "$(catalogue_select_sql "$1")"
}

# Best-effort rollback over a possibly dead session: never mask the loud
# refusal that follows (a dead session rolls back server-side on disconnect).
catalogue_rollback() {
  printf 'ROLLBACK;\n' >&"$1" 2>/dev/null || true
}

catalogue_journal_signature() {
  # Hash set only: migration application timestamps legitimately differ
  # between prod and preprod running the same release. Same set means the
  # same schema version; any drift refuses the import.
  catalogue_psql -At -c "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY 1"
}

# L0 early gate: measure the source catalogue and the requested target, then
# print a GO / NO-GO verdict as JSON. Thresholds are explicit arguments so the
# conductor owns the transfer budget (design gate: catalogue must fit it).
cmd_gate() {
  local target_db="" max_bytes=536870912 max_rows=1000000 map="" src_db src_server
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target-db) target_db="$2"; shift 2 ;;
      --max-bytes) max_bytes="$2"; shift 2 ;;
      --max-rows) max_rows="$2"; shift 2 ;;
      --map) map="$2"; shift 2 ;;
      *) catalogue_fail "gate: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$target_db" ]] || catalogue_fail 'gate: --target-db is required'
  src_db=$(catalogue_current_db)
  catalogue_refuse_prod "$src_db"
  catalogue_refuse_prod "$target_db"
  [[ "$target_db" != "$src_db" ]] || catalogue_fail 'gate: target must differ from source'
  catalogue_psql -c "SELECT to_regclass('artifacts.artifacts')" -At | grep -q artifacts \
    || catalogue_fail 'gate: artifacts schema absent from source'
  local reasons=() total_bytes=0 total_rows=0 table rows size
  total_bytes=$(catalogue_psql -At -c "SELECT COALESCE(sum(pg_total_relation_size('artifacts.' || tablename)), 0) FROM pg_tables WHERE schemaname = 'artifacts'")
  while read -r table; do
    [[ -n "$table" ]] || continue
    rows=$(catalogue_psql -At -c "SELECT count(*) FROM artifacts.\"$table\"")
    total_rows=$((total_rows + rows))
  done < <(catalogue_durable_tables)
  local pending open_uploads journal_n subjects_n uncovered=""
  pending=$(catalogue_psql -At -c "SELECT count(*) FROM artifacts.object_intents WHERE state = 'pending'")
  open_uploads=$(catalogue_psql -At -c "SELECT count(*) FROM artifacts.uploads WHERE state = 'open'")
  journal_n=$(catalogue_journal_signature | wc -l)
  subjects_n=$(catalogue_subjects | wc -l)
  ((pending == 0)) || reasons+=("in-flight operations pending: $pending")
  ((total_bytes <= max_bytes)) || reasons+=("catalogue bytes $total_bytes exceed budget $max_bytes")
  ((total_rows <= max_rows)) || reasons+=("catalogue rows $total_rows exceed budget $max_rows")
  if [[ -n "$map" ]]; then
    uncovered=$(catalogue_uncovered_subjects "$map" "$(catalogue_subjects)")
    [[ -z "$uncovered" ]] || reasons+=("subjects without explicit mapping: $(printf '%s' "$uncovered" | tr '\n' ' ')")
  fi
  local verdict=GO code=0
  if ((${#reasons[@]} > 0)); then verdict=NO-GO; code=1; fi
  printf '{"verdict":"%s","source":"%s","target":"%s","bytes":%s,"rows":%s,"pendingIntents":%s,"openUploads":%s,"journalEntries":%s,"subjects":%s,"reasons":[' \
    "$verdict" "$src_db" "$target_db" "$total_bytes" "$total_rows" "$pending" "$open_uploads" "$journal_n" "$subjects_n"
  local first=1 i
  for ((i = 0; i < ${#reasons[@]}; i++)); do
    if ((first)); then first=0; else printf ','; fi
    printf '"%s"' "$(printf '%s' "${reasons[$i]}" | sed 's/"/\\"/g')"
  done
  printf ']}\n'
  return "$code"
}

catalogue_subjects() {
  local spec schema_table column schema table
  for spec in $CATALOGUE_SUBJECT_COLUMNS; do
    schema_table="${spec%%|*}"
    column="${spec##*|}"
    if [[ "$schema_table" == *.* ]]; then
      schema="${schema_table%%.*}"; table="${schema_table##*.}"
    else
      schema=artifacts; table="$schema_table"
    fi
    catalogue_psql -At -c "SELECT DISTINCT $column FROM $schema.$table WHERE $column IS NOT NULL" 2>/dev/null || true
  done | sort -u
}

catalogue_uncovered_subjects() {
  # Subjects inputs may carry a second status column (subjects.tsv); only the
  # first field is an identity. The map's first field is the correspondence.
  local map="$1" subjects="$2" mapped s missing=""
  mapped=$(cut -f1 "$map" | sort -u)
  while IFS="$(printf '\t')" read -r s _rest; do
    [[ -n "$s" ]] || continue
    grep -qxF "$s" <<< "$mapped" || missing="${missing}${s}"$'\n'
  done <<< "$subjects"
  printf '%s' "$missing"
}

catalogue_json_escape() {
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' <<< "$1"
}

# Topological load order (parents first) over durable-table FK edges.
# Self-edges (0029 revert chains) are ordered by age at row level instead.
catalogue_load_order() {
  local list="$1" in
  in=$(printf '%s' "$list" | tr ' ' '\n' | grep . | sed "s/.*/'&'/" | paste -sd, -)
  catalogue_psql -At -c "WITH RECURSIVE deps(child, parent) AS (
      SELECT DISTINCT c.conrelid::regclass::text, c.confrelid::regclass::text
      FROM pg_constraint c WHERE c.contype = 'f'
        AND c.conrelid::regclass::text IN ($in) AND c.confrelid::regclass::text IN ($in)
        AND c.conrelid <> c.confrelid
    ), ord(t, d) AS (
      SELECT t.tname, 0 FROM (SELECT unnest(ARRAY[$in]) AS tname) t
        WHERE NOT EXISTS (SELECT 1 FROM deps WHERE deps.child = t.tname)
      UNION
      SELECT deps.child, o.d + 1 FROM deps JOIN ord o ON o.t = deps.parent
    ) SELECT t, max(d) FROM ord GROUP BY t ORDER BY 2, 1" | awk -F'|' '{sub(/^artifacts\./, "", $1); if (length($1) > 0) print $1}'
}

# Consistent export of the durable catalogue. pg_dump runs in a single
# transaction (one snapshot); in-flight publishes are refused beforehand.
cmd_export() {
  local out_dir="" scope="radar-immobilier-preprod"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --out-dir) out_dir="$2"; shift 2 ;;
      --scope) scope="$2"; shift 2 ;;
      *) catalogue_fail "export: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$out_dir" ]] || catalogue_fail 'export: --out-dir is required'
  if [[ -e "$out_dir" ]]; then
    [[ -d "$out_dir" ]] && [[ -z "$(ls -A "$out_dir")" ]] || catalogue_fail "export: refusing non-empty --out-dir '$out_dir'"
  else
    mkdir -p "$out_dir"
  fi
  mkdir -p "$out_dir/data"
  local src_db src_server generation created tables table
  src_db=$(catalogue_current_db)
  catalogue_refuse_prod "$src_db"
  catalogue_psql -At -c "SELECT to_regclass('artifacts.artifacts')" | grep -q artifacts \
    || catalogue_fail 'export: artifacts schema absent'
  [[ $(catalogue_psql -At -c "SELECT count(*) FROM artifacts.object_intents WHERE state = 'pending'") == 0 ]] \
    || catalogue_fail 'export: in-flight operations pending, drain first'
  tables=$(catalogue_durable_tables)
  [[ -n "$tables" ]] || catalogue_fail 'export: no durable catalogue tables found'
  local external_fk seqs
  external_fk=$(catalogue_psql -At -c "SELECT count(*) FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace JOIN pg_class f ON f.oid = c.confrelid JOIN pg_namespace fn ON fn.oid = f.relnamespace WHERE c.contype = 'f' AND n.nspname = 'artifacts' AND fn.nspname <> 'artifacts' AND r.relname IN ($(printf "'%s'," $tables | sed 's/,$//'))")
  ((external_fk == 0)) || catalogue_fail "export: catalogue has $external_fk foreign key(s) outside artifacts.*, refusing"
  seqs=$(catalogue_psql -At -c "SELECT count(*) FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace WHERE s.relkind = 'S' AND n.nspname = 'artifacts' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = s.oid AND d.deptype = 'i')")
  ((seqs == 0)) || catalogue_fail "export: $seqs sequence(s) in artifacts.*, refusing (unhandled)"
  src_server=$(catalogue_psql -At -c "SELECT version()")
  generation=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || catalogue_psql -At -c 'SELECT gen_random_uuid()')
  created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  catalogue_journal_signature > "$out_dir/journal.tsv"
  {
    printf 'table\trows\tfingerprint\n'
    local order rows fp cols
    order=$(catalogue_load_order "$(printf 'artifacts.%s ' $tables)")
    printf '%s\n' $order > "$out_dir/order.tsv"
    # Any durable table missing from the order is a cycle: fail closed.
    [[ $(grep -c . "$out_dir/order.tsv") == $(printf '%s\n' $tables | grep -c .) ]] \
      || catalogue_fail 'export: foreign-key cycle in catalogue, refusing'
    while read -r table; do
      [[ -n "$table" ]] || continue
      catalogue_table_columns "$table" | awk '{print $1}' > "$out_dir/data/$table.columns"
      catalogue_table_columns "$table" > "$out_dir/data/$table.coltypes"
      rows=$(catalogue_psql -At -c "SELECT count(*) FROM artifacts.\"$table\"")
      catalogue_psql -c "SET timezone = 'UTC'" -c "SET datestyle = 'ISO'" -c "$(catalogue_copy_sql "$table")" -At > "$out_dir/data/$table.copy"
      fp=$(sha256sum "$out_dir/data/$table.copy" | awk '{print $1}')
      printf '%s\t%s\t%s\n' "$table" "$rows" "$fp"
    done < "$out_dir/order.tsv" > "$out_dir/fingerprints.tsv"
  }
  # Referenced subjects with their preprod approval state (identity remap input).
  local values="" s firstv=1
  while read -r s; do
    [[ -n "$s" ]] || continue
    s=${s//\'/\'\'}
    if ((firstv)); then firstv=0; else values+=','; fi
    values+="('$s')"
  done < <(catalogue_subjects)
  if ((firstv)); then
    : > "$out_dir/subjects.tsv"
  else
    catalogue_psql -At -F $'\t' -c "SELECT s.sub, COALESCE(a.status, '') FROM (VALUES $values) AS s(sub) LEFT JOIN public.account_users a ON a.sub = s.sub ORDER BY 1" > "$out_dir/subjects.tsv"
  fi
  catalogue_psql -At -c 'SELECT DISTINCT digest FROM artifacts.blobs ORDER BY 1' > "$out_dir/digests.txt"
  local excludes=()
  local e
  for e in $CATALOGUE_EPHEMERAL_TABLES; do excludes+=(--exclude-table="artifacts.$e"); done
  pg_dump --format=custom --no-owner --no-privileges --schema=artifacts "${excludes[@]}" --file="$out_dir/catalogue.dump"
  # The archive must hold catalogue rows only: no public-schema data may leak in.
  # wc -l consumes the whole stream (a trailing grep -q would exit early and
  # SIGPIPE the pipeline into a missed leak under pipefail).
  local leak_count
  leak_count=$(pg_restore --list "$out_dir/catalogue.dump" | grep -E '^[0-9]+;' | grep -v 'SCHEMA artifacts' | awk '/TABLE DATA (public|drizzle)/{n++} END{print n+0}')
  ((leak_count == 0)) || catalogue_fail 'export: archive holds non-catalogue data, refusing'
  catalogue_write_manifest "$out_dir" "$scope" "$src_db" "$src_server" "$generation" "$created"
  (cd "$out_dir" && sha256sum catalogue.dump journal.tsv subjects.tsv digests.txt order.tsv fingerprints.tsv manifest.json data/*.columns data/*.coltypes data/*.copy > manifest.sha256)
  catalogue_log "exported catalogue from $src_db generation $generation into $out_dir"
}

catalogue_write_manifest() {
  local out_dir="$1" scope="$2" src_db="$3" src_server="$4" generation="$5" created="$6"
  local table rows fp cols_json first=1 journal_json ephemeral_json
  journal_json=$(awk '{printf "%s\"%s\"", (NR>1?",":""), $1}' "$out_dir/journal.tsv")
  ephemeral_json=$(for e in $CATALOGUE_EPHEMERAL_TABLES; do
    printf '{"table":"artifacts.%s","rows":%s},' "$e" "$(catalogue_psql -At -c "SELECT count(*) FROM artifacts.$e" 2>/dev/null || printf 0)"
  done | sed 's/,$//')
  {
    printf '{\n"formatVersion":%s,\n"generator":"artifacts-catalogue.sh",\n"scope":"%s",\n"createdAt":"%s",\n"generation":"%s",\n"sourceDatabase":"%s",\n"sourceServer":"%s",\n"journal":[%s],\n"ephemeral":[%s],\n"tables":[' \
      "$CATALOGUE_FORMAT_VERSION" "$(catalogue_json_escape "$scope")" "$created" \
      "$(catalogue_json_escape "$generation")" "$(catalogue_json_escape "$src_db")" \
      "$(catalogue_json_escape "$src_server")" "$journal_json" "$ephemeral_json"
    while IFS="$(printf '\t')" read -r table rows fp; do
      [[ "$table" == table ]] && continue
      [[ -n "$table" ]] || continue
      cols_json=$(awk '{printf "%s\"%s\"", (NR>1?",":""), $0}' "$out_dir/data/$table.columns")
      if ((first)); then first=0; else printf ','; fi
      printf '\n{"name":"%s","rows":%s,"fingerprint":"%s","columns":[%s]}' \
        "$(catalogue_json_escape "$table")" "$rows" "$fp" "$cols_json"
    done < "$out_dir/fingerprints.tsv"
    printf '\n],\n"digestsFile":"digests.txt",\n"subjectsFile":"subjects.tsv",\n"orderFile":"order.tsv"\n}\n'
  } > "$out_dir/manifest.json"
}

catalogue_manifest_value() {
  local in_dir="$1" key="$2"
  grep -o -m1 "\"$key\":\"[^\"]*\"" "$in_dir/manifest.json" | sed "s/\"$key\":\"//;s/\"$//"
}

catalogue_manifest_table_field() {
  # Two steps, no early exit anywhere: first isolate the table entry, then the
  # field inside it. A single grep cannot assume the field sits right after
  # the name (rows does, fingerprint does not). Every stage consumes its input
  # fully, so pipefail can never SIGPIPE either end.
  local in_dir="$1" table="$2" field="$3" flat entry
  flat=$(tr '\n' ' ' < "$in_dir/manifest.json")
  entry=$(printf '%s' "$flat" | grep -o "{\"name\":\"$table\",[^}]*}" | sed -n '1p')
  [[ -n "$entry" ]] || return 1
  printf '%s' "$entry" | grep -o "\"$field\":\(\"[^\"\"]*\"\|[^,}]*\)" | sed -n '1s/.*://p' | tr -d '"'
}

# File-only integrity gate: checksum chain + manifest shape. No database.
cmd_manifest_check() {
  local in_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --in-dir) in_dir="$2"; shift 2 ;;
      *) catalogue_fail "manifest-check: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$in_dir" ]] || catalogue_fail 'manifest-check: --in-dir is required'
  for f in manifest.json manifest.sha256 journal.tsv subjects.tsv digests.txt order.tsv fingerprints.tsv catalogue.dump; do
    [[ -f "$in_dir/$f" ]] || catalogue_fail "manifest-check: missing $f"
  done
  (cd "$in_dir" && sha256sum -c manifest.sha256) || catalogue_fail 'manifest-check: checksum mismatch'
  grep -q '"formatVersion":1' "$in_dir/manifest.json" || catalogue_fail 'manifest-check: unsupported format'
  for key in generator scope createdAt generation sourceDatabase journal tables; do
    grep -q "\"$key\":" "$in_dir/manifest.json" || catalogue_fail "manifest-check: manifest lacks $key"
  done
  catalogue_log 'manifest-check ok'
}

# File-only mapping validation: one subject per line, optional forced status.
cmd_map_check() {
  local map="" subjects=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --map) map="$2"; shift 2 ;;
      --subjects) subjects="$2"; shift 2 ;;
      *) catalogue_fail "map-check: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$map" ]] || catalogue_fail 'map-check: --map is required'
  [[ -f "$map" ]] || catalogue_fail 'map-check: map file missing'
  local line sub status n=0
  local seen
  seen=$(mktemp)
  while IFS="$(printf '\t')" read -r sub status _rest || [[ -n "$sub" ]]; do
    [[ -n "$sub" ]] || catalogue_fail 'map-check: empty subject line'
    grep -qxF "$sub" "$seen" 2>/dev/null && catalogue_fail "map-check: duplicate subject '$sub'"
    printf '%s\n' "$sub" >> "$seen"
    if [[ -n "${status:-}" ]]; then
      case "$status" in
        approved|pending|rejected) ;;
        *) catalogue_fail "map-check: bad status '$status' for '$sub'" ;;
      esac
    fi
    n=$((n + 1))
  done < "$map"
  rm -f "$seen"
  ((n > 0)) || catalogue_fail 'map-check: empty map'
  if [[ -n "$subjects" ]]; then
    local uncovered
    uncovered=$(catalogue_uncovered_subjects "$map" "$(cat "$subjects")")
    [[ -z "$uncovered" ]] || catalogue_fail "map-check: subjects without explicit mapping: $(printf '%s' "$uncovered" | tr '\n' ' ')"
  fi
  catalogue_log "map-check ok ($n explicit correspondence(s))"
}

# Durable copy (Lot 3): upload a sealed export to the preprod recovery bucket
# and prove it reads back. s5cmd only (the engine's existing UPLOAD_IMAGE, no
# new image); --s5cmd injects the binary (tests stub it). Read-back compares
# the object count and the generation id. The engine supplies the preprod
# recovery bucket from deploy/cutover/config.json; obvious prod names refuse.
cmd_archive() {
  local in_dir="" bucket="" prefix="" endpoint="" s5cmd_bin="s5cmd"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --in-dir) in_dir="$2"; shift 2 ;;
      --bucket) bucket="$2"; shift 2 ;;
      --prefix) prefix="$2"; shift 2 ;;
      --endpoint-url) endpoint="$2"; shift 2 ;;
      --s5cmd) s5cmd_bin="$2"; shift 2 ;;
      *) catalogue_fail "archive: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$in_dir" && -n "$bucket" && -n "$prefix" && -n "$endpoint" ]] \
    || catalogue_fail 'archive: --in-dir, --bucket, --prefix and --endpoint-url are required'
  catalogue_refuse_prod "$bucket"
  catalogue_refuse_prod "$prefix"
  cmd_manifest_check --in-dir "$in_dir" >/dev/null
  local generation dest local_count remote_count remote_generation
  generation=$(catalogue_manifest_value "$in_dir" generation)
  [[ -n "$generation" ]] || catalogue_fail 'archive: sealed export lacks a generation'
  prefix=${prefix%/}
  dest="s3://$bucket/$prefix/$generation/"
  "$s5cmd_bin" --endpoint-url "$endpoint" sync "$in_dir/" "$dest" \
    || catalogue_fail 'archive: upload refused'
  local_count=$(find "$in_dir" -type f | wc -l | tr -d ' ')
  remote_count=$("$s5cmd_bin" --endpoint-url "$endpoint" ls "$dest" | wc -l | tr -d ' ')
  [[ "$remote_count" == "$local_count" ]] || catalogue_fail "archive: read-back count $remote_count differs from sealed $local_count"
  remote_generation=$("$s5cmd_bin" --endpoint-url "$endpoint" cat "$dest/manifest.json" | grep -o '"generation":"[^"]*"' | sed 's/"generation":"//;s/"$//' || true)
  [[ "$remote_generation" == "$generation" ]] || catalogue_fail 'archive: read-back generation differs'
  catalogue_log "archived generation $generation to $dest ($remote_count objects, read back)"
}

# Byte-level proof that the live catalogue matches the manifest.
cmd_verify() {
  local in_dir="" union=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --in-dir) in_dir="$2"; shift 2 ;;
      --union) union=1; shift ;;
      *) catalogue_fail "verify: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$in_dir" ]] || catalogue_fail 'verify: --in-dir is required'
  cmd_manifest_check --in-dir "$in_dir" >/dev/null
  if ((union)); then catalogue_union_verify "$in_dir"; return; fi
  local failures=0 table rows fp want_rows want_fp tmp
  tmp=$(mktemp -d)
  catalogue_psql -At -c "SELECT to_regclass('artifacts.artifacts')" | grep -q artifacts \
    || catalogue_fail 'verify: artifacts schema absent'
  while IFS="$(printf '\t')" read -r table rows fp; do
    [[ "$table" == table ]] && continue
    [[ -n "$table" ]] || continue
    want_rows=$(catalogue_manifest_table_field "$in_dir" "$table" rows || true)
    want_fp=$(catalogue_manifest_table_field "$in_dir" "$table" fingerprint || true)
    [[ -n "$want_rows" && -n "$want_fp" ]] || catalogue_fail "verify: manifest lacks table $table"
    rows=$(catalogue_psql -At -c "SELECT count(*) FROM artifacts.\"$table\"")
    catalogue_psql -c "SET timezone = 'UTC'" -c "SET datestyle = 'ISO'" -c "$(catalogue_copy_sql "$table")" -At > "$tmp/$table.copy"
    fp=$(sha256sum "$tmp/$table.copy" | awk '{print $1}')
    if [[ "$rows" != "$want_rows" || "$fp" != "$want_fp" ]]; then
      printf '[catalogue] MISMATCH %s rows=%s(want %s) fp=%s(want %s)\n' "$table" "$rows" "$want_rows" "$fp" "$want_fp" >&2
      failures=$((failures + 1))
    fi
  done < "$in_dir/fingerprints.tsv"
  rm -rf "$tmp"
  if ((failures > 0)); then catalogue_fail "verify: $failures table(s) differ"; fi
  if [[ $(catalogue_journal_signature | sha256sum | awk '{print $1}') != \
        $(sha256sum "$in_dir/journal.tsv" | awk '{print $1}') ]]; then
    catalogue_fail 'verify: migration journal differs from manifest'
  fi
  catalogue_log 'verify ok — catalogue matches manifest byte-for-byte'
}

# Controlled re-import into the current database (restored candidate).
# Unattended path (no --map) never mints approvals: created rows land pending.
cmd_import() {
  local in_dir="" map="" report="" allow_same_db=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --in-dir) in_dir="$2"; shift 2 ;;
      --map) map="$2"; shift 2 ;;
      --report) report="$2"; shift 2 ;;
      --allow-same-db) allow_same_db=1; shift ;;
      *) catalogue_fail "import: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$in_dir" ]] || catalogue_fail 'import: --in-dir is required'
  [[ -z "$report" ]] && report="$in_dir/reconciliation.tsv"
  cmd_manifest_check --in-dir "$in_dir" >/dev/null
  local db generation manifest_db
  db=$(catalogue_current_db)
  catalogue_refuse_prod "$db"
  generation=$(catalogue_manifest_value "$in_dir" generation)
  manifest_db=$(catalogue_manifest_value "$in_dir" sourceDatabase)
  if [[ "$db" == "$manifest_db" ]] && ((allow_same_db == 0)); then
    catalogue_fail 'import: target is the export source (use --allow-same-db to repair in place)'
  fi
  if [[ -n "$map" ]]; then
    cmd_map_check --map "$map" --subjects "$in_dir/subjects.tsv" >/dev/null
  fi
  # Schema-version awareness. Same journal: the target must carry exactly the
  # export columns (drift outside migrations refuses). Newer target (journal is
  # a strict superset, e.g. a prepared candidate migrated to the next release):
  # every export column must exist in the target; new columns take their
  # defaults. An older target, or any other journal difference, refuses.
  local table want_cols have_cols newer=0 extra
  if [[ $(catalogue_journal_signature | sha256sum | awk '{print $1}') != \
        $(sha256sum "$in_dir/journal.tsv" | awk '{print $1}') ]]; then
    extra=$(LC_ALL=C comm -23 <(LC_ALL=C sort -u "$in_dir/journal.tsv") <(catalogue_journal_signature | LC_ALL=C sort -u))
    [[ -z "$extra" ]] || catalogue_fail 'import: migration journal differs from manifest (schema version mismatch)'
    newer=1
    catalogue_log 'import: target schema is newer than the export (journal superset), column superset accepted'
  fi
  while read -r table; do
    [[ -n "$table" ]] || continue
    [[ -f "$in_dir/data/$table.copy" ]] || catalogue_fail "import: missing data file for $table"
    want_cols=$(tr '\n' ' ' < "$in_dir/data/$table.columns")
    have_cols=$(catalogue_table_columns "$table" | awk '{print $1}' | tr '\n' ' ')
    if ((newer)); then
      extra=$(LC_ALL=C comm -23 <(tr ' ' '\n' <<< "$want_cols" | grep . | LC_ALL=C sort) <(tr ' ' '\n' <<< "$have_cols" | grep . | LC_ALL=C sort))
      [[ -z "$extra" ]] || catalogue_fail "import: export columns missing on $table (${extra//$'\n'/ })"
      # A target column the export lacks must be fillable: NOT NULL needs a default.
      extra=$(catalogue_psql -At -c "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE n.nspname = 'artifacts' AND c.relname = '$table' AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND d.oid IS NULL AND a.attidentity = '' AND a.attgenerated = ''" | LC_ALL=C sort | LC_ALL=C comm -23 - <(tr ' ' '\n' <<< "$want_cols" | grep . | LC_ALL=C sort))
      [[ -z "$extra" ]] || catalogue_fail "import: target column(s) NOT NULL without default absent from the export on $table (${extra//$'\n'/ })"
    else
      [[ "$want_cols" == "$have_cols" ]] || catalogue_fail "import: column mismatch on $table (want [$want_cols] have [$have_cols])"
    fi
    # Same name, different type: refused here, never at load time.
    if [[ -f "$in_dir/data/$table.coltypes" ]]; then
      extra=$(LC_ALL=C comm -23 <(LC_ALL=C sort "$in_dir/data/$table.coltypes") <(catalogue_table_columns "$table" | LC_ALL=C sort) | awk '{print $1}' | LC_ALL=C comm -12 - <(tr ' ' '\n' <<< "$have_cols" | grep . | LC_ALL=C sort))
      [[ -z "$extra" ]] || catalogue_fail "import: column type mismatch on $table (${extra//$'\n'/ })"
    fi
  done < "$in_dir/order.tsv"
  [[ $(catalogue_psql -At -c "SELECT count(*) FROM pg_extension WHERE extname = 'pgcrypto'") != 0 ]] \
    || catalogue_fail 'import: pgcrypto extension absent (identity remap needs it)'
  catalogue_import_session "$in_dir" "$map" "$report" "$generation"
  catalogue_union_verify "$in_dir" >/dev/null
  catalogue_log "imported generation $generation into $db, report $report"
}

catalogue_coproc_read_until() {
  local fd="$1" marker="$2" line
  while IFS= read -r line <&"$fd"; do
    [[ "$line" == "$marker" ]] && return 0
  done
  return 1
}

# Read single-line values preceding a marker. Fails loudly on EOF so a dead
# session can never pass as an empty value under set -e.
catalogue_coproc_read_value() {
  local fd="$1" marker="$2" line value=""
  while IFS= read -r line <&"$fd"; do
    if [[ "$line" == "$marker" ]]; then printf '%s' "$value"; return 0; fi
    value+="$line"
  done
  return 1
}

# ── Union import (owner rule 2026-11-15) ───────────────────────────────────
# The restore replays the PROD catalogue; the sealed export holds the PREPROD
# catalogue. The result is their union:
#   - a preprod row identical to a live row (same values; identity columns
#     ignored) is already there: skipped as "same" (prod rows that came in
#     with an earlier restore, so repeated restores never duplicate);
#   - a preprod-only row is inserted; identity columns (event logs) take a
#     fresh value after the prod sequence, never a prod id;
#   - a preprod row that hits ANY unique key of a different live row (same
#     artifact UUID, same scope/owner/binding name, same release id...) is a
#     collision: PROD WINS, the preprod row is not loaded and is journaled in
#     conflicts.tsv (table, reason, full row as JSON);
#   - a preprod row whose catalogue parent is absent from the live database
#     (parent lost a collision, or lives in an ephemeral table) is journaled
#     as orphan: never loaded dangling.
# Invariant per table, checked before COMMIT: exported = same + inserted +
# collisions + orphans. Nothing is dropped without a journal line.

catalogue_value_cols() {
  # Export columns minus the target identity columns: the comparison and
  # insert key of the union (columns added by a newer target take defaults).
  local in_dir="$1" table="$2" ident
  ident=$(catalogue_psql -At -c "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'artifacts' AND c.relname = '$table' AND a.attnum > 0 AND NOT a.attisdropped AND a.attidentity <> ''")
  if [[ -z "$ident" ]]; then cat "$in_dir/data/$table.columns"; else grep -vxF -f <(printf '%s\n' $ident) "$in_dir/data/$table.columns" || true; fi
}

catalogue_stage_sql() {
  # Untyped-constraint stage holding exactly the export columns, in order.
  local in_dir="$1" table="$2" name="$3" all
  all=$(sed 's/.*/"&"/' "$in_dir/data/$table.columns" | paste -sd, -)
  printf 'CREATE TEMP TABLE "%s" ON COMMIT DROP AS SELECT %s FROM artifacts."%s" WITH NO DATA;' "$name" "$all" "$table"
}

catalogue_fk_specs() {
  # parent|child columns|parent columns, for foreign keys to another table.
  catalogue_psql -At -c "SELECT pn.nspname || '.' || pc.relname || '|' || string_agg(quote_ident(a.attname), ',' ORDER BY k.ord) || '|' || string_agg(quote_ident(pa.attname), ',' ORDER BY k.ord)
    FROM pg_constraint co
    JOIN pg_class c ON c.oid = co.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class pc ON pc.oid = co.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    CROSS JOIN LATERAL unnest(co.conkey, co.confkey) WITH ORDINALITY AS k(ck, pk, ord)
    JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.ck
    JOIN pg_attribute pa ON pa.attrelid = co.confrelid AND pa.attnum = k.pk
    WHERE co.contype = 'f' AND n.nspname = 'artifacts' AND c.relname = '$1' AND co.conrelid <> co.confrelid
    GROUP BY co.oid, pn.nspname, pc.relname ORDER BY 1"
}

catalogue_row_expr() {
  # ROW(alias."c1", ...)::text over the value columns.
  local alias="$1" cols="$2" c out=""
  for c in $cols; do out="${out}${out:+, }$alias.\"$c\""; done
  printf 'ROW(%s)::text' "$out"
}

# One table of the union, inside the import transaction.
catalogue_union_table() {
  local in_dir="$1" table="$2" want_rows="$3" out="$4" in="$5"
  local stg="cat_stg_$table" cols collist srow trow spec parent ccols pcols cond i
  local staged same inserted collisions orphans=0 n
  cols=$(catalogue_value_cols "$in_dir" "$table" | tr '\n' ' ')
  [[ -n "$cols" ]] || { catalogue_rollback "$in"; catalogue_fail "import: no value columns for $table, rolled back"; }
  collist=$(for c in $cols; do printf '"%s",' "$c"; done | sed 's/,$//')
  srow=$(catalogue_row_expr s "$cols"); trow=$(catalogue_row_expr x "$cols")
  cat_send "$(catalogue_stage_sql "$in_dir" "$table" "$stg")" "CAT-STAGE-$table"
  printf '%s\n' "\\copy pg_temp.\"$stg\" FROM '$in_dir/data/$table.copy'" "SELECT 'CAT-LOAD-$table';" >&"$in"
  catalogue_coproc_read_until "$out" "CAT-LOAD-$table" || catalogue_fail "import: database session aborted loading $table"
  printf '%s\n' "SELECT count(*) FROM \"$stg\";" "SELECT 'CAT-COUNT-$table';" >&"$in"
  staged=$(catalogue_coproc_read_value "$out" "CAT-COUNT-$table") \
    || { catalogue_rollback "$in"; catalogue_fail "import: count marker missing for $table, rolled back"; }
  [[ "$staged" == "$want_rows" ]] || { catalogue_rollback "$in"; catalogue_fail "import: $table rows=$staged want=$want_rows, rolled back"; }
  while IFS='|' read -r parent ccols pcols; do
    [[ -n "$parent" ]] || continue
    cond=""
    IFS=',' read -ra cc <<< "$ccols"; IFS=',' read -ra pp <<< "$pcols"
    for i in "${!cc[@]}"; do cond="${cond}${cond:+ AND }s.${cc[$i]} IS NOT NULL"; done
    local join=""
    for i in "${!cc[@]}"; do join="${join}${join:+ AND }p.${pp[$i]} = s.${cc[$i]}"; done
    cond="$cond AND NOT EXISTS (SELECT 1 FROM $parent p WHERE $join)"
    printf '%s\n' "WITH o AS (DELETE FROM \"$stg\" s WHERE $cond RETURNING s.*) INSERT INTO cat_conflicts SELECT '$table', 'orphan:$parent', row_to_json(o)::text FROM o;" \
      "SELECT count(*) FROM cat_conflicts WHERE tbl = '$table';" "SELECT 'CAT-ORPHAN-$table';" >&"$in"
    orphans=$(catalogue_coproc_read_value "$out" "CAT-ORPHAN-$table") \
      || { catalogue_rollback "$in"; catalogue_fail "import: orphan marker missing for $table, rolled back"; }
  done < <(catalogue_fk_specs "$table")
  printf '%s\n' "WITH d AS (DELETE FROM \"$stg\" s WHERE $srow IN (SELECT $trow FROM artifacts.\"$table\" x) RETURNING 1) SELECT count(*) FROM d;" "SELECT 'CAT-SAME-$table';" >&"$in"
  same=$(catalogue_coproc_read_value "$out" "CAT-SAME-$table") \
    || { catalogue_rollback "$in"; catalogue_fail "import: same marker missing for $table, rolled back"; }
  printf '%s\n' "WITH i AS (INSERT INTO artifacts.\"$table\" ($collist) SELECT $collist FROM \"$stg\" ON CONFLICT DO NOTHING RETURNING 1) SELECT count(*) FROM i;" "SELECT 'CAT-INS-$table';" >&"$in"
  inserted=$(catalogue_coproc_read_value "$out" "CAT-INS-$table") \
    || { catalogue_rollback "$in"; catalogue_fail "import: insert marker missing for $table, rolled back"; }
  printf '%s\n' "WITH c AS (INSERT INTO cat_conflicts SELECT '$table', 'collision:prod-wins', row_to_json(s)::text FROM \"$stg\" s WHERE $srow NOT IN (SELECT $trow FROM artifacts.\"$table\" x) RETURNING 1) SELECT count(*) FROM c;" "SELECT 'CAT-COLL-$table';" >&"$in"
  collisions=$(catalogue_coproc_read_value "$out" "CAT-COLL-$table") \
    || { catalogue_rollback "$in"; catalogue_fail "import: collision marker missing for $table, rolled back"; }
  n=$((same + inserted + collisions + orphans))
  [[ "$n" == "$want_rows" ]] || { catalogue_rollback "$in"; catalogue_fail "import: $table union does not add up (exported=$want_rows accounted=$n), rolled back"; }
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$table" "$want_rows" "$same" "$inserted" "$collisions" "$orphans" >> "$in_dir/union.tsv"
  ((collisions + orphans == 0)) || catalogue_log "union $table: $collisions collision(s) prod-wins, $orphans orphan(s), journaled in conflicts.tsv"
}

# Post-commit proof of the union: every exported row is live (same values,
# identity columns ignored) or journaled in conflicts.tsv. Read-only.
catalogue_union_verify() {
  local in_dir="$1" table cols srow trow missing journaled failures=0
  [[ -f "$in_dir/conflicts.tsv" ]] || catalogue_fail 'verify: union journal conflicts.tsv missing'
  while read -r table; do
    [[ -n "$table" ]] || continue
    cols=$(catalogue_value_cols "$in_dir" "$table" | tr '\n' ' ')
    srow=$(catalogue_row_expr s "$cols"); trow=$(catalogue_row_expr x "$cols")
    missing=$(catalogue_psql -At -c "BEGIN" -c "$(catalogue_stage_sql "$in_dir" "$table" cat_v)" \
      -c "\\copy cat_v FROM '$in_dir/data/$table.copy'" \
      -c "SELECT count(*) FROM cat_v s WHERE $srow NOT IN (SELECT $trow FROM artifacts.\"$table\" x)")
    journaled=$(awk -F'\t' -v t="$table" '$1 == t' "$in_dir/conflicts.tsv" | wc -l | tr -d ' ')
    if [[ "$missing" != "$journaled" ]]; then
      printf '[catalogue] UNION GAP %s missing=%s journaled=%s\n' "$table" "$missing" "$journaled" >&2
      failures=$((failures + 1))
    fi
  done < "$in_dir/order.tsv"
  ((failures == 0)) || catalogue_fail "verify: $failures table(s) lose rows outside the journal"
  catalogue_log 'verify ok — union holds every exported row or its journal line'
}

# The whole load runs in ONE transaction driven over a coprocess: any error
# aborts the session, which rolls everything back. COMMIT only after the union
# accounting and the trigger state hold.
catalogue_import_session() {
  local in_dir="$1" map="$2" report="$3" generation="$4"
  local table rows want_rows disabled_before
  # tgenabled is a char (O/R/A enabled flavours, D disabled): DISABLE TRIGGER USER
  # marks rows D, so before/after parity compares the D count.
  disabled_before=$(catalogue_psql -At -c "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'artifacts' AND NOT t.tgisinternal AND t.tgenabled = 'D'")
  coproc CATPSQL { psql -X --no-psqlrc -q -A -t -v ON_ERROR_STOP=1; }
  local out=${CATPSQL[0]} in=${CATPSQL[1]}
  # No EXIT trap here: every logic refusal above sends ROLLBACK explicitly,
  # and any dead session (ON_ERROR_STOP abort, killed caller) rolls back on
  # the server side on disconnect. A trap would clobber the caller's cleanup.
  cat_send() { printf '%s\n' "$1" "SELECT '$2';" >&"$in"; catalogue_coproc_read_until "$out" "$2" || catalogue_fail "import: database session aborted during $2"; }
  cat_send 'BEGIN; SET timezone = '"'"'UTC'"'"'; SET datestyle = '"'"'ISO'"'"';' 'CAT-BEGIN'
  # User triggers only (publication guards, updated_at): foreign keys stay
  # enforced, so a row whose parent lost a collision can never land dangling.
  while read -r table; do
    [[ -n "$table" ]] || continue
    cat_send "ALTER TABLE artifacts.\"$table\" DISABLE TRIGGER USER;" "CAT-DISABLE-$table"
  done < "$in_dir/order.tsv"
  cat_send 'CREATE TEMP TABLE cat_conflicts (tbl text NOT NULL, reason text NOT NULL, payload text NOT NULL) ON COMMIT DROP;' 'CAT-JOURNAL'
  printf 'table\texported\tsame\tinserted\tcollisions\torphans\n' > "$in_dir/union.tsv"
  while read -r table; do
    [[ -n "$table" ]] || continue
    want_rows=$(catalogue_manifest_table_field "$in_dir" "$table" rows)
    catalogue_union_table "$in_dir" "$table" "$want_rows" "$out" "$in"
  done < "$in_dir/order.tsv"
  printf '%s\n' "\\copy (SELECT tbl, reason, payload FROM cat_conflicts ORDER BY 1, 2, 3) TO '$in_dir/conflicts.tsv'" "SELECT 'CAT-CONFLICTS';" >&"$in"
  catalogue_coproc_read_until "$out" 'CAT-CONFLICTS' || { catalogue_rollback "$in"; catalogue_fail 'import: session aborted writing the conflict journal'; }
  catalogue_import_identities "$in_dir" "$map" "$report" "$out" "$in"
  while read -r table; do
    [[ -n "$table" ]] || continue
    cat_send "ALTER TABLE artifacts.\"$table\" ENABLE TRIGGER USER;" "CAT-ENABLE-$table"
  done < "$in_dir/order.tsv"
  local disabled_after
  printf '%s\n' "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'artifacts' AND NOT t.tgisinternal AND t.tgenabled = 'D';" "SELECT 'CAT-TRG';" >&"$in"
  disabled_after=$(catalogue_coproc_read_value "$out" 'CAT-TRG') \
    || { catalogue_rollback "$in"; catalogue_fail 'import: trigger marker missing, rolled back'; }
  [[ "$disabled_after" == "$disabled_before" ]] || { catalogue_rollback "$in"; catalogue_fail 'import: trigger state not restored, rolled back'; }
  cat_send 'COMMIT;' 'CAT-COMMIT'
  exec {in}>&-; wait "$CATPSQL_PID" 2>/dev/null || true
}

# Identity reconciliation (design §4.5): artifact UUIDs and TEXT subject
# references are kept verbatim. Referenced subjects resolve to target accounts
# by sub; missing ones are created with a FRESH uuid — never by reassigning a
# uuid the restored data already references. A target row rejected while the
# export says approved is a divergence: refuse. Memberships are never copied;
# they are reported for the operator.
catalogue_import_identities() {
  local in_dir="$1" map="$2" report="$3" out="$4" in="$5"
  local sub exported_status row account_id target_status action create_status esc
  printf 'subject\texported_status\taction\ttarget_account\n' > "$report"
  while IFS="$(printf '\t')" read -r sub exported_status; do
    [[ -n "$sub" ]] || continue
    if [[ -n "$map" ]] && ! grep -qxF "$sub" <(cut -f1 "$map"); then
      catalogue_rollback "$in"; catalogue_fail "import: subject '$sub' lacks explicit mapping, rolled back"
    fi
    esc=${sub//\'/\'\'}
    printf '%s\n' "SELECT id || '|' || status FROM public.account_users WHERE sub = '$esc';" "SELECT 'CAT-SUB';" >&"$in"
    row=$(catalogue_coproc_read_value "$out" 'CAT-SUB') \
      || { catalogue_rollback "$in"; catalogue_fail "import: identity marker missing for '$sub', rolled back"; }
    if [[ -z "$row" ]]; then
      if [[ -n "$map" ]]; then
        create_status=$(awk -F'\t' -v s="$sub" '$1 == s {print $2}' "$map")
        [[ -n "$create_status" ]] || create_status="$exported_status"
        [[ -n "$create_status" ]] || create_status='pending'
      else
        # Unattended path never mints approvals.
        create_status="$exported_status"
        [[ "$create_status" == approved ]] && create_status='pending'
        [[ -n "$create_status" ]] || create_status='pending'
      fi
      case "$create_status" in
        approved|pending|rejected) ;;
        *) catalogue_rollback "$in"; catalogue_fail "import: bad creation status for '$sub', rolled back" ;;
      esac
      printf '%s\n' "INSERT INTO public.account_users (id, sub, status) VALUES (gen_random_uuid(), '$esc', '$create_status') RETURNING id;" "SELECT 'CAT-NEW';" >&"$in"
      account_id=$(catalogue_coproc_read_value "$out" 'CAT-NEW') \
        || { catalogue_rollback "$in"; catalogue_fail "import: creation marker missing for '$sub', rolled back"; }
      action="created:$create_status"
    else
      account_id="${row%%|*}"; target_status="${row##*|}"
      if [[ "$target_status" == rejected && "$exported_status" == approved ]]; then
        catalogue_rollback "$in"; catalogue_fail "import: subject '$sub' revoked in target but approved in export, rolled back"
      fi
      action="kept:$target_status"
    fi
    printf '%s\t%s\t%s\t%s\n' "$sub" "$exported_status" "$action" "$account_id" >> "$report"
  done < "$in_dir/subjects.tsv"
}

# ── Stash: carry sealed exports across Jobs inside the restored database ──
# The restore Job exports the live preprod catalogue before the schema reset
# and stashes it in schema catalogue_stash of the database it restores (the
# reset never drops catalogue_stash nor catalogue_journal). The catalogue Job
# runs after the migrations (ddl, data) and imports it in union, then drops
# the stash. Conflicts are kept in catalogue_journal (durable, in-database).
#
# Each stashed export is a GENERATION tagged with the run and backup pin that
# took it (TAG). A relaunch of the same run reuses its own generation. A stash
# left by ANOTHER run (its import never completed) is never imported alone:
# the live database is exported again and stashed as a newer generation, and
# the import replays every generation, newest first. Rows changed after the
# old run therefore win over the old copy; old rows the new export lacks come
# back; a row both versions hold differently is journaled, never dropped.
CATALOGUE_STASH_SCHEMA=catalogue_stash
CATALOGUE_JOURNAL_SCHEMA=catalogue_journal

cmd_stash_exists() {
  [[ $(catalogue_psql -At -c "SELECT to_regclass('$CATALOGUE_STASH_SCHEMA.meta') IS NOT NULL") == t ]] \
    && [[ $(catalogue_psql -At -c "SELECT count(*) FROM $CATALOGUE_STASH_SCHEMA.meta") != 0 ]]
}

# Tag of the newest generation (empty when there is no stash).
cmd_stash_tag() {
  cmd_stash_exists || return 0
  catalogue_psql -At -c "SELECT tag FROM $CATALOGUE_STASH_SCHEMA.meta ORDER BY seq DESC LIMIT 1"
}

cmd_stash() {
  local in_dir="" tag=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --in-dir) in_dir="$2"; shift 2 ;;
      --tag) tag="$2"; shift 2 ;;
      *) catalogue_fail "stash: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$in_dir" && -n "$tag" ]] || catalogue_fail 'stash: --in-dir and --tag are required'
  [[ "$tag" =~ ^[A-Za-z0-9:._-]+$ ]] || catalogue_fail 'stash: bad tag'
  catalogue_refuse_prod "$(catalogue_current_db)"
  cmd_manifest_check --in-dir "$in_dir" >/dev/null
  local files f count seq generation
  generation=$(catalogue_manifest_value "$in_dir" generation)
  files=$( (cd "$in_dir" && awk '{print $2}' manifest.sha256; printf 'manifest.sha256\n') | LC_ALL=C sort -u)
  {
    printf 'BEGIN;\nCREATE SCHEMA IF NOT EXISTS %s;\n' "$CATALOGUE_STASH_SCHEMA"
    printf 'CREATE TABLE IF NOT EXISTS %s.meta (seq int PRIMARY KEY, tag text NOT NULL, generation text NOT NULL UNIQUE, stashed_at timestamptz NOT NULL DEFAULT now());\n' "$CATALOGUE_STASH_SCHEMA"
    printf 'CREATE TABLE IF NOT EXISTS %s.files (seq int NOT NULL REFERENCES %s.meta (seq), path text NOT NULL, b64 text NOT NULL, PRIMARY KEY (seq, path));\n' "$CATALOGUE_STASH_SCHEMA" "$CATALOGUE_STASH_SCHEMA"
    printf "INSERT INTO %s.meta (seq, tag, generation) SELECT COALESCE(max(seq), 0) + 1, '%s', '%s' FROM %s.meta;\n" "$CATALOGUE_STASH_SCHEMA" "$tag" "$generation" "$CATALOGUE_STASH_SCHEMA"
    printf 'CREATE TEMP TABLE cat_files (path text, b64 text) ON COMMIT DROP;\nCOPY cat_files (path, b64) FROM STDIN;\n'
    while read -r f; do
      [[ -n "$f" ]] || continue
      printf '%s\t%s\n' "$f" "$(base64 -w0 < "$in_dir/$f")"
    done <<< "$files"
    printf '\\.\n'
    printf "INSERT INTO %s.files (seq, path, b64) SELECT (SELECT max(seq) FROM %s.meta), path, b64 FROM cat_files;\n" "$CATALOGUE_STASH_SCHEMA" "$CATALOGUE_STASH_SCHEMA"
    printf 'COMMIT;\n'
  } | catalogue_psql --file=- >/dev/null
  seq=$(catalogue_psql -At -c "SELECT seq FROM $CATALOGUE_STASH_SCHEMA.meta WHERE generation = '$generation'")
  count=$(catalogue_psql -At -c "SELECT count(*) FROM $CATALOGUE_STASH_SCHEMA.files WHERE seq = $seq")
  [[ "$count" == "$(grep -c . <<< "$files")" ]] || catalogue_fail "stash: read-back count $count differs"
  catalogue_log "stashed generation $generation as #$seq tag $tag ($count files) in $(catalogue_current_db)"
}

# Write generation SEQ of the stash of the current database into DIR.
catalogue_unstash() {
  local seq="$1" dir="$2" path
  rm -rf "$dir"; mkdir -p "$dir/data"
  while read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in /*|*..*) catalogue_fail "unstash: unsafe path in stash" ;; esac
    catalogue_psql -At -c "SELECT b64 FROM $CATALOGUE_STASH_SCHEMA.files WHERE seq = $seq AND path = '${path//\'/\'\'}'" | base64 -d > "$dir/$path"
  done < <(catalogue_psql -At -c "SELECT path FROM $CATALOGUE_STASH_SCHEMA.files WHERE seq = $seq ORDER BY 1")
  cmd_manifest_check --in-dir "$dir" >/dev/null
}

# Copy every generation of the stash of database FROM into the current one
# (prepared path: a pending stash of the live database must follow the data).
cmd_stash_carry() {
  local from_db="" work="" seq tag
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from-db) from_db="$2"; shift 2 ;;
      --work) work="$2"; shift 2 ;;
      *) catalogue_fail "stash-carry: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$from_db" && -n "$work" ]] || catalogue_fail 'stash-carry: --from-db and --work are required'
  PGDATABASE="$from_db" cmd_stash_exists || return 0
  while IFS='|' read -r seq tag; do
    [[ -n "$seq" ]] || continue
    PGDATABASE="$from_db" catalogue_unstash "$seq" "$work/carry-$seq"
    cmd_stash --in-dir "$work/carry-$seq" --tag "$tag"
  done < <(PGDATABASE="$from_db" catalogue_psql -At -c "SELECT seq || '|' || tag FROM $CATALOGUE_STASH_SCHEMA.meta ORDER BY seq")
  catalogue_log "stash-carry: pending generations of $from_db carried over"
}

cmd_stash_drop() {
  catalogue_refuse_prod "$(catalogue_current_db)"
  catalogue_psql -c "DROP SCHEMA IF EXISTS $CATALOGUE_STASH_SCHEMA CASCADE" >/dev/null
}

# ── Scope rewrite (owner decision 2026-11-15) ─────────────────────────────
# Prod rows replayed into preprod carry the prod storage scope; preprod serves
# its own scope only. rewrite-scope moves every artifacts.* row of scope FROM
# to scope TO, in one transaction, BEFORE the union import (so the union rule
# also covers slug collisions under the preprod scope). Blob keys follow the
# scope (artifacts/<scope>/blobs/sha256/<hex>); the blob Job copies them first.
# With --blob-keys the blob check runs INSIDE that transaction: a missing blob
# rolls the rewrite back. Scope-level environment configuration (host_policy,
# host_quotas) of the prod scope is dropped: the preprod rows come back with
# the union. The preprod storage_scopes row is taken from the export when
# present. Foreign keys that involve storage_scope_id are dropped and
# re-created (validated) around the update. Values embedded in JSON (receipts,
# signed bodies) are left as is.
CATALOGUE_SCOPE_CONFIG_TABLES="host_policy host_quotas"

# SQL: digests of visible releases of SCOPE absent from temp table cat_keys.
catalogue_missing_blobs_sql() {
  printf "SELECT count(DISTINCT m[1]) FROM artifacts.releases r JOIN artifacts.artifacts a ON a.id = r.artifact_id CROSS JOIN LATERAL regexp_matches(r.manifest, 'sha256:([0-9a-f]+)', 'g') m WHERE a.storage_scope_id = '%s' AND a.lifecycle_state NOT IN ('deleted', 'purged') AND a.terminal_deleted_at IS NULL AND r.state <> 'purged' AND m[1] NOT IN (SELECT hex FROM cat_keys)" "$1"
}

cmd_rewrite_scope() {
  local from="" to="" export_dir="" keys="" t
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from) from="$2"; shift 2 ;;
      --to) to="$2"; shift 2 ;;
      --export) export_dir="$2"; shift 2 ;;
      --blob-keys) keys="$2"; shift 2 ;;
      *) catalogue_fail "rewrite-scope: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$from" && -n "$to" && "$from" != "$to" ]] || catalogue_fail 'rewrite-scope: --from and --to are required and must differ'
  [[ "$from$to" =~ ^[a-z0-9.-]+$ ]] || catalogue_fail 'rewrite-scope: scope ids must be [a-z0-9.-]'
  [[ -z "$keys" || -f "$keys" ]] || catalogue_fail 'rewrite-scope: --blob-keys file missing'
  catalogue_refuse_prod "$(catalogue_current_db)"
  local tables
  tables=$(catalogue_psql -At -c "SELECT c.relname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'artifacts' AND c.relkind = 'r' AND a.attname = 'storage_scope_id' AND NOT a.attisdropped ORDER BY 1")
  {
    printf 'BEGIN;\n'
    printf 'CREATE TEMP TABLE cat_fk ON COMMIT DROP AS SELECT co.conrelid::regclass::text AS tbl, co.conname, pg_get_constraintdef(co.oid) AS def FROM pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace WHERE co.contype = %s AND n.nspname = %s AND (EXISTS (SELECT 1 FROM unnest(co.conkey) k JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k WHERE a.attname = %s) OR co.confrelid = %s::regclass);\n' \
      "'f'" "'artifacts'" "'storage_scope_id'" "'artifacts.storage_scopes'"
    printf "DO \$fk\$ DECLARE r record; BEGIN FOR r IN SELECT * FROM cat_fk LOOP EXECUTE format('ALTER TABLE %%s DROP CONSTRAINT %%I', r.tbl, r.conname); END LOOP; END \$fk\$;\n"
    if [[ -n "$export_dir" && -f "$export_dir/data/storage_scopes.copy" ]]; then
      printf 'CREATE TEMP TABLE cat_scope ON COMMIT DROP AS SELECT %s FROM artifacts.storage_scopes WITH NO DATA;\n' \
        "$(sed 's/.*/"&"/' "$export_dir/data/storage_scopes.columns" | paste -sd, -)"
      printf '\\copy cat_scope FROM %s\n' "'$export_dir/data/storage_scopes.copy'"
      printf 'INSERT INTO artifacts.storage_scopes (%s) SELECT * FROM cat_scope WHERE id = %s ON CONFLICT DO NOTHING;\n' \
        "$(sed 's/.*/"&"/' "$export_dir/data/storage_scopes.columns" | paste -sd, -)" "'$to'"
    fi
    printf "INSERT INTO artifacts.storage_scopes SELECT (jsonb_populate_record(NULL::artifacts.storage_scopes, to_jsonb(s) || jsonb_build_object('id', '%s', 'org_id', '%s'))).* FROM artifacts.storage_scopes s WHERE s.id = '%s' ON CONFLICT DO NOTHING;\n" "$to" "$to" "$from"
    for t in $CATALOGUE_SCOPE_CONFIG_TABLES; do
      grep -qx "$t" <<< "$tables" && printf "DELETE FROM artifacts.\"%s\" WHERE storage_scope_id = '%s';\n" "$t" "$from"
    done
    while read -r t; do
      [[ -n "$t" ]] || continue
      printf "UPDATE artifacts.\"%s\" SET storage_scope_id = '%s' WHERE storage_scope_id = '%s';\n" "$t" "$to" "$from"
    done <<< "$tables"
    printf "DELETE FROM artifacts.storage_scopes WHERE id = '%s';\n" "$from"
    printf "DO \$fk\$ DECLARE r record; BEGIN FOR r IN SELECT * FROM cat_fk LOOP EXECUTE format('ALTER TABLE %%s ADD CONSTRAINT %%I %%s', r.tbl, r.conname, r.def); END LOOP; END \$fk\$;\n"
    if [[ -n "$keys" ]]; then
      # Blob check before COMMIT: rows whose blobs are missing never become visible.
      printf 'CREATE TEMP TABLE cat_keys (hex text) ON COMMIT DROP;\n\\copy cat_keys FROM %s\n' "'$keys'"
      printf "DO \$bc\$ DECLARE n bigint; BEGIN %s INTO n; IF n > 0 THEN RAISE EXCEPTION 'blob-check: %% blob(s) referenced by visible releases of %s are absent from the bucket, refusing', n; END IF; END \$bc\$;\n" \
        "$(catalogue_missing_blobs_sql "$to" | sed 's/^SELECT count/SELECT count/; s/ FROM artifacts.releases/ FROM artifacts.releases/')" "$to"
    fi
    printf 'COMMIT;\n'
  } | catalogue_psql --file=- >/dev/null
  local left
  left=$(catalogue_psql -At -c "SELECT count(*) FROM artifacts.storage_scopes WHERE id = '$from'")
  [[ "$left" == 0 ]] || catalogue_fail "rewrite-scope: scope $from still present"
  catalogue_log "rewrite-scope: rows of scope $from now under $to"
}

# Every blob referenced by a visible release of scope SCOPE must be present in
# the preprod artifacts bucket. KEYS lists the object names (sha256 hex) under
# artifacts/<SCOPE>/blobs/sha256/, as listed by the blob Job. Read-only.
cmd_blob_check() {
  local scope="" keys="" missing
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --scope) scope="$2"; shift 2 ;;
      --keys) keys="$2"; shift 2 ;;
      *) catalogue_fail "blob-check: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$scope" && -f "$keys" ]] || catalogue_fail 'blob-check: --scope and a readable --keys file are required'
  [[ "$scope" =~ ^[a-z0-9.-]+$ ]] || catalogue_fail 'blob-check: bad scope id'
  missing=$(LC_ALL=C sort -u "$keys" | { grep -E '^[0-9a-f]+$' || true; } | catalogue_psql -At \
    -c 'CREATE TEMP TABLE cat_keys (hex text)' -c '\copy cat_keys FROM STDIN' \
    -c "$(catalogue_missing_blobs_sql "$scope")")
  ((missing == 0)) || catalogue_fail "blob-check: $missing blob(s) referenced by visible releases of $scope are absent from the bucket, refusing"
  catalogue_log "blob-check ok — every visible release of $scope has its blobs"
}

# Rewrite the prod scope (blob check inside, before COMMIT), import every
# stashed generation newest first, check the blobs again, journal, drop the
# stash. No stash: only the scope rewrite and its blob check run. A rerun after
# a lost drop is safe: the union counts every row as "same".
cmd_import_stash() {
  local work="" map="" dir generation from="" to="" keys="" seq newest=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --work) work="$2"; shift 2 ;;
      --map) map="$2"; shift 2 ;;
      --rewrite-from) from="$2"; shift 2 ;;
      --rewrite-to) to="$2"; shift 2 ;;
      --blob-keys) keys="$2"; shift 2 ;;
      *) catalogue_fail "import-stash: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$work" ]] || catalogue_fail 'import-stash: --work is required'
  [[ -z "$from$to" || ( -n "$from" && -n "$to" ) ]] || catalogue_fail 'import-stash: --rewrite-from and --rewrite-to go together'
  [[ -z "$keys" || -n "$to" ]] || catalogue_fail 'import-stash: --blob-keys needs --rewrite-to (the preprod scope)'
  catalogue_refuse_prod "$(catalogue_current_db)"
  local seqs=""
  if cmd_stash_exists; then
    seqs=$(catalogue_psql -At -c "SELECT seq FROM $CATALOGUE_STASH_SCHEMA.meta ORDER BY seq DESC")
    newest=$(head -n1 <<< "$seqs")
    for seq in $seqs; do catalogue_unstash "$seq" "$work/export-$seq"; done
  fi
  if [[ -n "$from" ]]; then
    set -- --from "$from" --to "$to"
    [[ -z "$newest" ]] || set -- "$@" --export "$work/export-$newest"
    [[ -z "$keys" ]] || set -- "$@" --blob-keys "$keys"
    cmd_rewrite_scope "$@"
  fi
  if [[ -z "$seqs" ]]; then catalogue_log 'import-stash: no stash, nothing to import'; return 0; fi
  for seq in $seqs; do
    dir="$work/export-$seq"
    generation=$(catalogue_manifest_value "$dir" generation)
    if [[ -n "$map" ]]; then cmd_import --in-dir "$dir" --allow-same-db --map "$map"; else cmd_import --in-dir "$dir" --allow-same-db; fi
    tail -n +2 "$dir/union.tsv" > "$dir/union.rows"
    catalogue_psql -c "CREATE SCHEMA IF NOT EXISTS $CATALOGUE_JOURNAL_SCHEMA" \
      -c "CREATE TABLE IF NOT EXISTS $CATALOGUE_JOURNAL_SCHEMA.conflicts (generation text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, reason text NOT NULL, payload text NOT NULL)" \
      -c "CREATE TABLE IF NOT EXISTS $CATALOGUE_JOURNAL_SCHEMA.imports (generation text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, exported int NOT NULL, same int NOT NULL, inserted int NOT NULL, collisions int NOT NULL, orphans int NOT NULL)" \
      -c "CREATE TEMP TABLE j (tbl text, reason text, payload text)" -c "\\copy j FROM '$dir/conflicts.tsv'" \
      -c "INSERT INTO $CATALOGUE_JOURNAL_SCHEMA.conflicts (generation, tbl, reason, payload) SELECT '$generation', tbl, reason, payload FROM j" \
      -c "CREATE TEMP TABLE u (tbl text, exported int, same int, inserted int, collisions int, orphans int)" \
      -c "\\copy u FROM '$dir/union.rows'" \
      -c "INSERT INTO $CATALOGUE_JOURNAL_SCHEMA.imports (generation, tbl, exported, same, inserted, collisions, orphans) SELECT '$generation', * FROM u" >/dev/null
    catalogue_log "import-stash: generation $generation (#$seq) imported in union"
  done
  # Final control on the union: every visible release has its blobs. On a
  # refusal the stash stays and the controller keeps the site closed.
  [[ -z "$keys" ]] || cmd_blob_check --scope "$to" --keys "$keys"
  cmd_stash_drop
  catalogue_log "import-stash: $(wc -w <<< "$seqs" | tr -d ' ') generation(s) imported, journal in $CATALOGUE_JOURNAL_SCHEMA, stash dropped"
}

cmd_main() {
  local cmd="${1:-}"
  [[ -n "$cmd" ]] || catalogue_fail 'usage: artifacts-catalogue.sh {gate|export|import|verify|archive|manifest-check|map-check|stash|stash-exists|stash-tag|stash-carry|stash-drop|import-stash|rewrite-scope|blob-check} ...'
  shift
  case "$cmd" in
    gate) cmd_gate "$@" ;;
    export) cmd_export "$@" ;;
    import) cmd_import "$@" ;;
    verify) cmd_verify "$@" ;;
    archive) cmd_archive "$@" ;;
    manifest-check) cmd_manifest_check "$@" ;;
    map-check) cmd_map_check "$@" ;;
    stash) cmd_stash "$@" ;;
    stash-exists) cmd_stash_exists ;;
    stash-tag) cmd_stash_tag ;;
    stash-carry) cmd_stash_carry "$@" ;;
    stash-drop) cmd_stash_drop ;;
    import-stash) cmd_import_stash "$@" ;;
    rewrite-scope) cmd_rewrite_scope "$@" ;;
    blob-check) cmd_blob_check "$@" ;;
    *) catalogue_fail "unknown command '$cmd'" ;;
  esac
}

cmd_main "$@"
