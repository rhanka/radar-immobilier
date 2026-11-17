#!/usr/bin/env bash
# Destructive-migration guard for prod promotion.
# Prod has applied migrations up to 0044 (2026-11). Any NEWER drizzle file
# must stay expand-only: no DROP TABLE/DATABASE/SCHEMA, no DROP COLUMN, no
# DELETE FROM, no TRUNCATE statement, no RENAME. DROP TRIGGER / DROP INDEX /
# DROP CONSTRAINT and trigger bodies (BEFORE UPDATE OR DELETE, BEFORE
# TRUNCATE) are not data-destructive and stay allowed (0047 uses them).
# Escape hatch, owner only: a first-line marker
#   -- owner-approved-destructive: YYYY-MM-DD
# in the file itself. Usage: check-migration-destructive.sh [dir] [baseline]
set -euo pipefail
dir="${1:-api/drizzle}"
baseline="${2:-0044}"
[[ $baseline =~ ^[0-9]{4}$ ]] || { echo "migration guard: baseline must be NNNN, got '$baseline'" >&2; exit 1; }
[[ -d $dir ]] || { echo "migration guard: no such directory: $dir" >&2; exit 1; }
patterns='DROP[[:space:]]+(TABLE|DATABASE|SCHEMA)[[:space:]]|DROP[[:space:]]+COLUMN[[:space:]]|DELETE[[:space:]]+FROM[[:space:]]|(^|;)[[:space:]]*TRUNCATE[[:space:]]|RENAME[[:space:]]+(TO|COLUMN)[[:space:]]|ALTER[[:space:]]+TABLE[^;]*[[:space:]]RENAME[[:space:]]'
bad=0
checked=0
for file in "$dir"/*.sql; do
  [[ -e $file ]] || continue
  name="$(basename "$file")"
  num="${name%%_*}"
  [[ $num =~ ^[0-9]{4}$ ]] || continue
  ((10#$num > 10#$baseline)) || continue
  checked=$((checked + 1))
  if grep -Eq '^[[:space:]]*--[[:space:]]*owner-approved-destructive:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$file"; then
    echo "migration guard: $name carries an owner-approved destructive marker, skipped"
    continue
  fi
  # Strip -- comments (the marker is already handled above), then scan.
  hits="$(sed 's/--.*$//' "$file" | grep -inE "$patterns" || true)"
  if [[ -n $hits ]]; then
    printf 'migration guard: destructive statement in new migration %s (baseline %s):\n%s\n' "$name" "$baseline" "$hits" >&2
    bad=1
  fi
done
[[ $bad -eq 0 ]] || { echo 'migration guard: refused. Add the owner marker to the file or make the migration expand-only.' >&2; exit 1; }
echo "migration guard: ok (${checked} migration(s) newer than ${baseline}, 0 destructive)"
