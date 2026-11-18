#!/usr/bin/env bash
# Hermetic tests of the enroll-muse make target (refresh-018.mk): no cluster,
# no enrollment is ever run. The guards must refuse before docker is reached,
# and a dry run (make -n) must render the exact owner command.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MK="$HERE/refresh-018.mk"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/keyring"
# Guard fixture only: the file is never read, only its presence is tested.
touch "$TMP/keyring/.key"

run_target() { make --no-print-directory -f "$MK" enroll-muse "$@" 2>&1; }

out="$(run_target ENV=ci)"; code=$?
[ $code -ne 0 ] && grep -Fq "ENV=test-refresh-018 is required" <<<"$out" \
  && ok "refuses without ENV=test-refresh-018" || bad "refuses without ENV=test-refresh-018"

out="$(run_target ENV=test-refresh-018)"; code=$?
[ $code -ne 0 ] && grep -Fq "LOCAL_IMAGE is required" <<<"$out" \
  && ok "refuses without LOCAL_IMAGE" || bad "refuses without LOCAL_IMAGE"

out="$(run_target LOCAL_IMAGE=fixture KEYRING_SOURCE_DIR="$TMP/absent" ENV=test-refresh-018)"; code=$?
[ $code -ne 0 ] && grep -Fq "keyring master key is required" <<<"$out" \
  && ok "refuses without the keyring master key file" || bad "refuses without the keyring master key file"

out="$(run_target LOCAL_IMAGE=fixture KEYRING_SOURCE_DIR="$TMP/keyring" ENV=test-refresh-018)"; code=$?
[ $code -ne 0 ] && grep -Fq "REFRESH_OWNER_SCOPE_REF is required" <<<"$out" \
  && ok "refuses without REFRESH_OWNER_SCOPE_REF" || bad "refuses without REFRESH_OWNER_SCOPE_REF"

dry="$(make --no-print-directory -n -f "$MK" enroll-muse LOCAL_IMAGE=fixture KEYRING_SOURCE_DIR="$TMP/keyring" REFRESH_OWNER_SCOPE_REF=owner-fixture ENV=test-refresh-018 2>&1)"
for needle in "--network host" "enroll-muse.mjs:/workspace/enroll-muse.mjs:ro" "node /workspace/enroll-muse.mjs" ":/keyring"; do
  grep -Fq -- "$needle" <<<"$dry" && ok "dry run renders: $needle" || bad "dry run renders: $needle"
done
grep -Fq "MUSE_KEYRING_DIR" <<<"$dry" \
  && bad "dry run keeps the script default keyring dir (no MUSE_KEYRING_DIR override)" \
  || ok "dry run keeps the script default keyring dir (no MUSE_KEYRING_DIR override)"

echo "enroll-targets.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
