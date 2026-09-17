#!/bin/sh
# Restore a selected complete backup into a disposable database, then report
# table counts and the dump SHA-256. Never targets POSTGRES_DB.
set -eu
: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}" "${POSTGRES_DB:?}"
: "${RESTORE_DATABASE:?}"
[ "$RESTORE_DATABASE" != "$POSTGRES_DB" ] || { echo 'restore database must differ from source' >&2; exit 2; }
export PGPASSWORD="$POSTGRES_PASSWORD"
sha256sum -c /work/restore.dump.sha256
count_sql="SELECT schemaname || '.' || relname || ':' || n_live_tup FROM pg_stat_user_tables ORDER BY 1"
psql -h "${PGHOST:-radar-postgres}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$count_sql" > /work/source-table-counts.txt
psql -h "${PGHOST:-radar-postgres}" -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"${RESTORE_DATABASE}\"" \
  -c "CREATE DATABASE \"${RESTORE_DATABASE}\""
pg_restore -h "${PGHOST:-radar-postgres}" -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" \
  --no-owner --no-privileges --exit-on-error /work/restore.dump
psql -h "${PGHOST:-radar-postgres}" -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" -At -c "$count_sql" > /work/table-counts.txt
cmp /work/source-table-counts.txt /work/table-counts.txt
cat /work/table-counts.txt
printf 'restore verification passed: sha256=%s tables=%s source-counts=matched\n' "$(cut -d ' ' -f 1 /work/restore.dump.sha256)" "$(wc -l < /work/table-counts.txt)"
