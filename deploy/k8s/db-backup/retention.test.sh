#!/bin/sh
set -eu
ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/bin"
cat > "$ROOT/bin/aws" <<'SH'
#!/bin/sh
if [ "$4" = ls ]; then
  printf '%s\n' '2026-09-01 00:00:00 1 postgres/preprod/daily/radar-1.manifest.json' '2026-09-02 00:00:00 1 postgres/preprod/daily/radar-2.manifest.json' '2026-09-03 00:00:00 1 postgres/preprod/daily/radar-3.manifest.json'
else echo "$5" >> "$CALLS"; fi
SH
chmod +x "$ROOT/bin/aws"
CALLS="$ROOT/calls" PATH="$ROOT/bin:$PATH" BACKUP_S3_BUCKET=x BACKUP_S3_ENDPOINT=x BACKUP_ENV=preprod AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=x BACKUP_RETAIN_DAILY=2 BACKUP_RETAIN_WEEKLY=0 BACKUP_RETAIN_MONTHLY=0 sh "$(dirname "$0")/retention.sh"
grep -q 'radar-1.dump$' "$ROOT/calls"
grep -q 'radar-1.dump.sha256$' "$ROOT/calls"
grep -q 'radar-1.manifest.json$' "$ROOT/calls"
! grep -q 'radar-2' "$ROOT/calls"
echo 'PASS retention oldest complete set only'
