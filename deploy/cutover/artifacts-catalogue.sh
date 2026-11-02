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
#   artifacts-catalogue.sh verify --in-dir DIR
#   artifacts-catalogue.sh archive --in-dir DIR --bucket NAME --prefix PATH --endpoint-url URL [--s5cmd BIN]
#   artifacts-catalogue.sh manifest-check --in-dir DIR
#   artifacts-catalogue.sh map-check --map FILE --subjects FILE
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
  seqs=$(catalogue_psql -At -c "SELECT count(*) FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace WHERE s.relkind = 'S' AND n.nspname = 'artifacts'")
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
  (cd "$out_dir" && sha256sum catalogue.dump journal.tsv subjects.tsv digests.txt order.tsv fingerprints.tsv manifest.json data/*.columns data/*.copy > manifest.sha256)
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
  local in_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --in-dir) in_dir="$2"; shift 2 ;;
      *) catalogue_fail "verify: unknown argument '$1'" ;;
    esac
  done
  [[ -n "$in_dir" ]] || catalogue_fail 'verify: --in-dir is required'
  cmd_manifest_check --in-dir "$in_dir" >/dev/null
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
  # Schema-version awareness: the target must carry exactly the journal and
  # columns the export was taken with. A 0029 export on a 0028 target (or the
  # reverse) refuses here instead of silently dropping or inventing columns.
  if [[ $(catalogue_journal_signature | sha256sum | awk '{print $1}') != \
        $(sha256sum "$in_dir/journal.tsv" | awk '{print $1}') ]]; then
    catalogue_fail 'import: migration journal differs from manifest (schema version mismatch)'
  fi
  local table want_cols have_cols
  while read -r table; do
    [[ -n "$table" ]] || continue
    [[ -f "$in_dir/data/$table.copy" ]] || catalogue_fail "import: missing data file for $table"
    want_cols=$(tr '\n' ' ' < "$in_dir/data/$table.columns")
    have_cols=$(catalogue_table_columns "$table" | awk '{print $1}' | tr '\n' ' ')
    [[ "$want_cols" == "$have_cols" ]] || catalogue_fail "import: column mismatch on $table (want [$want_cols] have [$have_cols])"
  done < "$in_dir/order.tsv"
  [[ $(catalogue_psql -At -c "SELECT count(*) FROM pg_extension WHERE extname = 'pgcrypto'") != 0 ]] \
    || catalogue_fail 'import: pgcrypto extension absent (identity remap needs it)'
  catalogue_import_session "$in_dir" "$map" "$report" "$generation"
  cmd_verify --in-dir "$in_dir" >/dev/null
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

# The whole load runs in ONE transaction driven over a coprocess: any error
# aborts the session, which rolls everything back. COMMIT only after counts,
# trigger state and fingerprints all match the manifest.
catalogue_import_session() {
  local in_dir="$1" map="$2" report="$3" generation="$4"
  local table rows want_rows disabled_before
  # tgenabled is a char (O/R/A enabled flavours, D disabled): DISABLE TRIGGER ALL
  # marks rows D, so before/after parity compares the D count.
  disabled_before=$(catalogue_psql -At -c "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'artifacts' AND NOT t.tgisinternal AND t.tgenabled = 'D'")
  coproc CATPSQL { psql -X --no-psqlrc -q -A -t -v ON_ERROR_STOP=1; }
  local out=${CATPSQL[0]} in=${CATPSQL[1]}
  # No EXIT trap here: every logic refusal above sends ROLLBACK explicitly,
  # and any dead session (ON_ERROR_STOP abort, killed caller) rolls back on
  # the server side on disconnect. A trap would clobber the caller's cleanup.
  cat_send() { printf '%s\n' "$1" "SELECT '$2';" >&"$in"; catalogue_coproc_read_until "$out" "$2" || catalogue_fail "import: database session aborted during $2"; }
  cat_send 'BEGIN; SET timezone = '"'"'UTC'"'"'; SET datestyle = '"'"'ISO'"'"';' 'CAT-BEGIN'
  while read -r table; do
    [[ -n "$table" ]] || continue
    cat_send "ALTER TABLE artifacts.\"$table\" DISABLE TRIGGER ALL;" "CAT-DISABLE-$table"
  done < "$in_dir/order.tsv"
  while read -r table; do
    [[ -n "$table" ]] || continue
    printf '%s\n' "\\copy artifacts.\"$table\" FROM '$in_dir/data/$table.copy'" "SELECT 'CAT-LOAD-$table';" >&"$in"
    catalogue_coproc_read_until "$out" "CAT-LOAD-$table" || catalogue_fail "import: database session aborted loading $table"
    want_rows=$(catalogue_manifest_table_field "$in_dir" "$table" rows)
    printf '%s\n' "SELECT count(*) FROM artifacts.\"$table\";" "SELECT 'CAT-COUNT-$table';" >&"$in"
    rows=$(catalogue_coproc_read_value "$out" "CAT-COUNT-$table") \
      || { catalogue_rollback "$in"; catalogue_fail "import: count marker missing for $table, rolled back"; }
    [[ "$rows" == "$want_rows" ]] || { catalogue_rollback "$in"; catalogue_fail "import: $table rows=$rows want=$want_rows, rolled back"; }
  done < "$in_dir/order.tsv"
  catalogue_import_identities "$in_dir" "$map" "$report" "$out" "$in"
  while read -r table; do
    [[ -n "$table" ]] || continue
    cat_send "ALTER TABLE artifacts.\"$table\" ENABLE TRIGGER ALL;" "CAT-ENABLE-$table"
  done < "$in_dir/order.tsv"
  local disabled_after
  printf '%s\n' "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'artifacts' AND NOT t.tgisinternal AND t.tgenabled = 'D';" "SELECT 'CAT-TRG';" >&"$in"
  disabled_after=$(catalogue_coproc_read_value "$out" 'CAT-TRG') \
    || { catalogue_rollback "$in"; catalogue_fail 'import: trigger marker missing, rolled back'; }
  [[ "$disabled_after" == "$disabled_before" ]] || { catalogue_rollback "$in"; catalogue_fail 'import: trigger state not restored, rolled back'; }
  local fp want_fp
  while IFS="$(printf '\t')" read -r table _rows fp; do
    [[ "$table" == table ]] && continue
    [[ -n "$table" ]] || continue
    want_fp=$(catalogue_manifest_table_field "$in_dir" "$table" fingerprint)
    printf '%s\n' "\\copy ($(catalogue_select_sql "$table")) TO '$in_dir/fp.$table'" "SELECT 'CAT-FP-$table';" >&"$in"
    catalogue_coproc_read_until "$out" "CAT-FP-$table" || { catalogue_rollback "$in"; catalogue_fail "import: session aborted fingerprinting $table"; }
    fp=$(sha256sum "$in_dir/fp.$table" | awk '{print $1}'); rm -f "$in_dir/fp.$table"
    [[ "$fp" == "$want_fp" ]] || { catalogue_rollback "$in"; catalogue_fail "import: $table fingerprint differs, rolled back"; }
  done < "$in_dir/fingerprints.tsv"
  cat_send 'COMMIT;' 'CAT-COMMIT'
  exec {in}>&-; wait "${CATPSQL_PID}" 2>/dev/null || true
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

cmd_main() {
  local cmd="${1:-}"
  [[ -n "$cmd" ]] || catalogue_fail 'usage: artifacts-catalogue.sh {gate|export|import|verify|archive|manifest-check|map-check} ...'
  shift
  case "$cmd" in
    gate) cmd_gate "$@" ;;
    export) cmd_export "$@" ;;
    import) cmd_import "$@" ;;
    verify) cmd_verify "$@" ;;
    archive) cmd_archive "$@" ;;
    manifest-check) cmd_manifest_check "$@" ;;
    map-check) cmd_map_check "$@" ;;
    *) catalogue_fail "unknown command '$cmd'" ;;
  esac
}

cmd_main "$@"
