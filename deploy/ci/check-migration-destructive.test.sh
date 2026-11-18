#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
accept() { bash "$HERE/check-migration-destructive.sh" "$T/drizzle" 0044 >"$T/out" 2>&1; grep -q 'migration guard: ok' "$T/out"; ok "$1"; }
reject() {
  if bash "$HERE/check-migration-destructive.sh" "$T/drizzle" 0044 >"$T/out" 2>&1; then echo "FAIL: accepted $1" >&2; exit 1; fi
  grep -Fq "$2" "$T/out"; ok "rejects $1"
}
mkdir -p "$T/drizzle"
# The real migrations newer than the prod baseline 0044 must pass as-is.
for f in "$ROOT"/api/drizzle/004[5-9]*.sql; do [[ -e $f ]] && cp "$f" "$T/drizzle/"; done
accept 'real migrations 0045+ (incl. DROP TRIGGER / BEFORE DELETE in 0047)'
# A benign future migration passes.
printf 'ALTER TABLE t ADD COLUMN c text;\n' >"$T/drizzle/0048_benign.sql"
accept 'benign 0048'
rm "$T/drizzle/0048_benign.sql"
# Destructive fixtures are refused.
printf 'DROP TABLE facet_events;\n' >"$T/drizzle/0049_drop.sql"
reject 'DROP TABLE in a new migration' '0049_drop.sql'
printf -- '-- owner-approved-destructive: 2026-11-17\nDROP TABLE facet_events;\n' >"$T/drizzle/0049_drop.sql"
accept 'DROP TABLE with the owner marker'
rm "$T/drizzle/0049_drop.sql"
printf 'DELETE FROM facet_events WHERE true;\n' >"$T/drizzle/0049_delete.sql"
reject 'DELETE FROM in a new migration' '0049_delete.sql'
rm "$T/drizzle/0049_delete.sql"
printf 'TRUNCATE facet_events;\n' >"$T/drizzle/0049_truncate.sql"
reject 'TRUNCATE in a new migration' '0049_truncate.sql'
rm "$T/drizzle/0049_truncate.sql"
printf 'ALTER TABLE facet_events RENAME TO facet_events_old;\n' >"$T/drizzle/0049_rename.sql"
reject 'RENAME in a new migration' '0049_rename.sql'
rm "$T/drizzle/0049_rename.sql"
printf 'ALTER TABLE facet_events DROP COLUMN city_slug;\n' >"$T/drizzle/0049_dropcol.sql"
reject 'DROP COLUMN in a new migration' '0049_dropcol.sql'
rm "$T/drizzle/0049_dropcol.sql"
# At or below the baseline, history is out of scope.
printf 'DROP TABLE facet_events;\n' >"$T/drizzle/0044_history.sql"
accept 'destructive statement at the baseline (already applied in prod)'
rm "$T/drizzle/0044_history.sql"
echo "PASS=$PASS FAIL=0"
