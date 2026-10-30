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
  pg_restore --no-owner --no-privileges --exit-on-error -j 4 --dbname="$PGDATABASE" "$dump"
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
