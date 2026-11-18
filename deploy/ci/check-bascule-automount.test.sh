#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bash "$HERE/check-bascule-automount.sh" "$ROOT/deploy/ci/bascule-preprod/db-ro-role-provision.yaml" \
  "$ROOT/deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml" \
  "$ROOT/deploy/ci/backup/cronjob-backup-daily.yaml" \
  "$ROOT/deploy/ci/backup/cronjob-backup-freshness.yaml" >"$T/out"
grep -q 'automount guard: ok' "$T/out"; ok 'committed bascule-bundle-cd pod templates all set automount false'
cp "$ROOT/deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml" "$T/bad.yaml"
sed -i '/automountServiceAccountToken: false/d' "$T/bad.yaml"
if bash "$HERE/check-bascule-automount.sh" "$T/bad.yaml" >"$T/out" 2>&1; then echo 'FAIL: accepted a template without automount false' >&2; exit 1; fi
grep -Fq 'does not set automountServiceAccountToken: false' "$T/out"; ok 'a template without automount false is refused'
cp "$ROOT/deploy/ci/bascule-preprod/db-ro-role-provision.yaml" "$T/bad2.yaml"
sed -i 's/automountServiceAccountToken: false/automountServiceAccountToken: true/' "$T/bad2.yaml"
if bash "$HERE/check-bascule-automount.sh" "$T/bad2.yaml" >"$T/out" 2>&1; then echo 'FAIL: accepted automount true' >&2; exit 1; fi
ok 'automount true is refused'
echo "PASS=$PASS FAIL=0"
