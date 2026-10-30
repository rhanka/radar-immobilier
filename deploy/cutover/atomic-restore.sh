# Atomic, relaunchable restore of a custom-format pg_dump archive.
# Embedded in the `restore` container of db-restore-backup-job.tmpl.yaml and run
# directly by deploy/cutover/atomic-restore.test.sh. Runtime inputs (libpq PG*,
# no password URI): PGDATABASE, EXPECTED_DATABASE, TARGET_DB (empty = live
# database), LIVE_DB, RESTORE_DUMP, EXPECTED_TOC_ENTRIES, RESTORE_ASSERT_DB,
# DUMP_DATABASE.
#
# A snapshot older than the destination schema (fewer migrations) cannot be
# restored with `pg_restore --clean`: dropping a primary key that newer foreign
# keys depend on aborts the whole transaction. Every application schema is
# therefore dropped with CASCADE and recreated before the archive is replayed
# without --clean, so a rerun starts from the same empty state (idempotent).
#  - live database: schema reset and archive replay share ONE transaction.
#    COMMIT is emitted only when pg_restore read the complete archive; a
#    truncated or unreadable archive ends with ROLLBACK (psql --single-transaction
#    would commit a truncated stream, hence the explicit BEGIN/COMMIT).
#  - disposable prepared database (TARGET_DB): the reset commits first, then
#    `pg_restore -j 4` loads the now-empty database in parallel.
set -euo pipefail
dump=$RESTORE_DUMP
[ -n "$PGDATABASE" ] && [ "$PGDATABASE" = "$EXPECTED_DATABASE" ] || { echo "[restore] ERROR — unexpected database"; exit 2; }
if [ -n "$TARGET_DB" ]; then
  [ "$PGDATABASE" = "$TARGET_DB" ] || { echo "[restore] ERROR — target database mismatch"; exit 2; }
  [ -n "$LIVE_DB" ] && [ "$LIVE_DB" != "$TARGET_DB" ] || { echo "[restore] ERROR — target is the live database"; exit 2; }
fi
pg_restore --list "$dump" > /tmp/toc.txt
toc="$(grep -c '^[0-9]' /tmp/toc.txt || true)"
if [ -n "$EXPECTED_TOC_ENTRIES" ] && [ "$toc" != "$EXPECTED_TOC_ENTRIES" ]; then
  echo "[restore] ERROR — TOC entries $toc != manifest $EXPECTED_TOC_ENTRIES (restore refused)"; exit 1
fi
src_db="$(awk -F': ' '/^;[[:space:]]+dbname:/ {print $2; exit}' /tmp/toc.txt | tr -d '[:space:]')"
if [ "$RESTORE_ASSERT_DB" = "1" ]; then
  if [ -z "$src_db" ] || [ "$src_db" != "$DUMP_DATABASE" ]; then
    echo "[restore] ERROR — archive dbname differs from manifest (restore refused)"; exit 1
  fi
else
  echo "[restore] dbname check DISABLED (RESTORE_ASSERT_DB=0)"
fi
echo "[restore] toc_entries=$toc archive verified"
reset_schemas() {
  printf '%s\n' \
    'DO $reset$ DECLARE s name; BEGIN' \
    "  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname !~ '^pg_' LOOP" \
    "    EXECUTE format('DROP SCHEMA %I CASCADE', s);" \
    '  END LOOP;' \
    'END $reset$;' \
    'CREATE SCHEMA public;' \
    'GRANT USAGE ON SCHEMA public TO PUBLIC;'
}
if [ -n "$TARGET_DB" ]; then
  reset_schemas | psql -X --no-psqlrc -v ON_ERROR_STOP=1 --single-transaction --quiet --file=-
  # Measurement: per-item durations from timestamped --verbose output, cgroup CPU before/after.
  metrics=${CUTOVER_METRICS:-/tmp/cutover-metrics}
  cpu_stat() { awk -v p="$1" '{print p $1 "=" $2}' /sys/fs/cgroup/cpu.stat 2>/dev/null || true; }
  cpu_stat before_ > /tmp/cpu-before
  started=$EPOCHREALTIME
  set +e
  pg_restore --no-owner --no-privileges --exit-on-error --verbose -j "${RESTORE_JOBS:-4}" --dbname="$PGDATABASE" "$dump" 2>&1 >/dev/null |
    while IFS= read -r line; do printf '%s %s\n' "$EPOCHREALTIME" "$line"; done > /tmp/restore-verbose.log
  status=${PIPESTATUS[0]}
  set -e
  if [ "$status" != 0 ]; then grep -v ' pg_restore: \(launching\|finished\|processing\) ' /tmp/restore-verbose.log | tail -20 >&2; exit "$status"; fi
  ended=$EPOCHREALTIME
  awk '$3=="launching" && $4=="item" {start[$5]=$1; $1=$2=$3=$4=""; name[$5]=$0}
    $3=="finished" && $4=="item" && ($5 in start) {printf "%d %s\n", ($1-start[$5])*1000, name[$5]}' \
    /tmp/restore-verbose.log | sort -rn | head -10 > /tmp/restore-top
  sed 's/^/[restore] top-item-ms /' /tmp/restore-top
  {
    printf 'restoreMs=%d\n' "$(awk -v a="$started" -v b="$ended" 'BEGIN{printf "%d", (b-a)*1000}')"
    awk '{printf "top%dMs=%d\n", NR, $1}' /tmp/restore-top
    cpu_stat after_
    cat /tmp/cpu-before
  } | awk -F= '{d[$1]=$2} END {
      for (k in d) if (k !~ /^(before|after)_/) print k "=" d[k]
      split("usage_usec nr_throttled throttled_usec", ks, " ")
      for (i in ks) if (("after_" ks[i]) in d) print "cpu_" ks[i] "=" (d["after_" ks[i]] - d["before_" ks[i]])
    }' > "$metrics"
  sed 's/^/[restore] metric /' "$metrics"
  echo "[restore] ok — archive loaded into prepared database $PGDATABASE"
  exit 0
fi
{
  printf 'BEGIN;\n'
  reset_schemas
  if pg_restore --no-owner --no-privileges --exit-on-error --file=- "$dump"; then
    printf '\nCOMMIT;\n'
  else
    printf '\nROLLBACK;\n'
    exit 1
  fi
} | psql -X --no-psqlrc -v ON_ERROR_STOP=1 --quiet --file=- > /dev/null
echo "[restore] ok — archive loaded atomically into $PGDATABASE"
