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
for needle in "--network host" "--entrypoint node" "enroll-muse.mjs:/workspace/enroll-muse.mjs:ro" "/workspace/enroll-muse.mjs" ":/keyring"; do
  grep -Fq -- "$needle" <<<"$dry" && ok "dry run renders: $needle" || bad "dry run renders: $needle"
done
# make -n renders the recipe over several backslash-continued lines: join
# them before any cross-argument pattern, or grep reads line by line and can
# never see an entrypoint/argument duplication.
joined() { printf '%s' "$1" | tr '\n' ' '; }
# With node as the entrypoint, the script must be the only argument: a leading
# node argument makes node execute a module literally named "node".
grep -Eq -- "--entrypoint node.* node /workspace" <<<"$(joined "$dry")" \
  && bad "enroll-muse dry run must not render --entrypoint node ... node /workspace" \
  || ok "enroll-muse dry run must not render --entrypoint node ... node /workspace"
# The published API image entrypoint refuses anything but a service mode:
# every owner target that runs node or a shell must override the entrypoint.
for target in enroll-codex enroll-cloud-code; do
  scope="REFRESH_OWNER_SCOPE_REF=owner-fixture"
  [ "$target" = enroll-cloud-code ] && scope="CLOUD_CODE_OWNER_SCOPE_REF=owner-fixture"
  dry="$(make --no-print-directory -n -f "$MK" "$target" LOCAL_IMAGE=fixture KEYRING_SOURCE_DIR="$TMP/keyring" $scope ENV=test-refresh-018 2>&1)"
  grep -Fq -- "--entrypoint node" <<<"$dry" && ok "$target dry run renders: --entrypoint node" || bad "$target dry run renders: --entrypoint node"
  grep -Eq -- "--entrypoint node.* node /workspace" <<<"$(joined "$dry")" \
    && bad "$target dry run must not render --entrypoint node ... node /workspace" \
    || ok "$target dry run must not render --entrypoint node ... node /workspace"
done
dry="$(make --no-print-directory -n -f "$MK" keyring-summary LOCAL_IMAGE=fixture KEYRING_SOURCE_DIR="$TMP/keyring" ENV=test-refresh-018 2>&1)"
grep -Fq -- "--entrypoint /bin/sh" <<<"$dry" && ok "keyring-summary dry run renders: --entrypoint /bin/sh" || bad "keyring-summary dry run renders: --entrypoint /bin/sh"
# With /bin/sh as the entrypoint, the shell must receive only -ceu: a leading
# /bin/sh argument would make it interpret the binary itself as a script.
grep -Fq "/bin/sh /bin/sh" <<<"$dry" \
  && bad "keyring-summary dry run must not render /bin/sh /bin/sh" \
  || ok "keyring-summary dry run must not render /bin/sh /bin/sh"
grep -Eq -- "--entrypoint /bin/sh .*/bin/sh -ceu" <<<"$(joined "$dry")" \
  && bad "keyring-summary dry run must not render --entrypoint /bin/sh ... /bin/sh -ceu" \
  || ok "keyring-summary dry run must not render --entrypoint /bin/sh ... /bin/sh -ceu"
grep -Fq "MUSE_KEYRING_DIR" <<<"$dry" \
  && bad "dry run keeps the script default keyring dir (no MUSE_KEYRING_DIR override)" \
  || ok "dry run keeps the script default keyring dir (no MUSE_KEYRING_DIR override)"

echo "enroll-targets.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
