#!/usr/bin/env bash
# =============================================================================
# db-backup.test.sh — hermetic tests for db-backup.sh (no cluster, no S3).
#
# Shims `kubectl` and `s5cmd` as fake executables on PATH, then drives
# db-backup.sh through its guarantees. The one that matters most is FAIL-CLOSED:
# a dump/upload failure MUST exit non-zero so the release step aborts before it
# ever rolls the image. Run: bash deploy/ci/db-backup.test.sh
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/db-backup.sh"
[ -f "$SCRIPT" ] || { echo "cannot find db-backup.sh next to test"; exit 2; }

ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok  : $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
eq()   { [ "$1" = "$2" ] && ok "$3" || bad "$3 (want '$2' got '$1')"; }
nonzero() { [ "$1" -ne 0 ] && ok "$2 (exit $1)" || bad "$2 (expected non-zero, got 0)"; }

# Fake kubectl + s5cmd into a per-case bin dir. Calls are recorded as files in
# the case dir ($CALLS_DIR): `cp` = uploaded dest, `rm` = pruned object.
make_bin() {
  local d="$1"; mkdir -p "$d/bin"
  cat > "$d/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
mode="${FAKE_DUMP_MODE:-ok}"
case " $* " in
  *" exec "*)
    case "$mode" in
      fail)    echo "error: exec into pod failed" >&2; exit 1 ;;
      empty)   exit 0 ;;
      garbage) echo "ERROR:  relation \"x\" does not exist"; exit 0 ;;
      *)       printf -- '--\n-- PostgreSQL database dump\n--\nCREATE TABLE t (id int);\nINSERT INTO t VALUES (1);\n' ;;
    esac ;;
  *) exit 0 ;;
esac
EOF
  cat > "$d/bin/s5cmd" <<'EOF'
#!/usr/bin/env bash
calls="${CALLS_DIR:?}"
shift 2                 # drop `--endpoint-url <ep>`
cmd="${1:-}"; shift || true
case "$cmd" in
  cp)
    [ "${FAKE_S5_CP_MODE:-ok}" = fail ] && { echo "cp failed" >&2; exit 1; }
    echo "$2" >> "$calls/cp" ;;      # args: SRC DEST
  ls)
    [ "${FAKE_S5_LS_MODE:-ok}" = fail ] && { echo "ls failed" >&2; exit 1; }
    printf '%s\n' "${FAKE_S5_LS:-}" ;;
  rm)
    [ "${FAKE_S5_RM_MODE:-ok}" = fail ] && { echo "rm failed" >&2; exit 1; }
    echo "$1" >> "$calls/rm" ;;      # args: OBJ
esac
exit 0
EOF
  chmod +x "$d/bin/kubectl" "$d/bin/s5cmd"
}

# run_case <name> : mints a case dir, exports the standard env, then evals the
# caller-provided `EXTRA` (env overrides / FAKE_ toggles) before running. Sets
# GLOBALS `CASE_DIR` + `CODE` (NOT echoed — a `$(run_case)` capture would run it
# in a subshell and lose CASE_DIR, breaking cp_calls/rm_calls).
CASE_DIR=""; CODE=0
run_case() {
  CASE_DIR="$(mktemp -d "${ROOT}/c.XXXXXX")"; make_bin "$CASE_DIR"
  (
    export PATH="${CASE_DIR}/bin:${PATH}" CALLS_DIR="$CASE_DIR"
    export BACKUP_ENV=preprod BACKUP_TAG=abc1234 NAMESPACE=radar-immobilier-preprod
    export BACKUP_S3_BUCKET=radar-db-backups BACKUP_S3_ENDPOINT=https://s3.fr-par.scw.cloud
    export AWS_ACCESS_KEY_ID=fake-key AWS_SECRET_ACCESS_KEY=fake-secret
    eval "${EXTRA:-}"
    bash "$SCRIPT"
  ) >"${CASE_DIR}/out" 2>&1
  CODE=$?
}
cp_calls() { cat "${CASE_DIR}/cp" 2>/dev/null || true; }
rm_calls() { cat "${CASE_DIR}/rm" 2>/dev/null || true; }

echo "== db-backup.sh =="

# 1. happy path: uploads once, key well-formed, exit 0.
EXTRA=''; run_case happy; code=$CODE
eq "$code" 0 "happy: exit 0"
dest="$(cp_calls)"
case "$dest" in
  s3://radar-db-backups/db-backups/preprod-abc1234-*.sql.gz) ok "happy: uploaded key well-formed ($dest)" ;;
  *) bad "happy: unexpected upload dest ($dest)" ;;
esac
eq "$(cp_calls | grep -c .)" 1 "happy: exactly one upload"

# 2. dump/exec failure → fail-closed, no upload.
EXTRA='export FAKE_DUMP_MODE=fail'; run_case dump_fail; code=$CODE
nonzero "$code" "dump failure aborts"
eq "$(cp_calls | grep -c .)" 0 "dump failure: no upload attempted"

# 3. empty dump → fail-closed.
EXTRA='export FAKE_DUMP_MODE=empty'; run_case empty_dump; code=$CODE
nonzero "$code" "empty dump aborts"
eq "$(cp_calls | grep -c .)" 0 "empty dump: no upload"

# 4. dump without pg_dump header (error mis-streamed) → fail-closed.
EXTRA='export FAKE_DUMP_MODE=garbage'; run_case garbage_dump; code=$CODE
nonzero "$code" "headerless dump aborts"
eq "$(cp_calls | grep -c .)" 0 "headerless dump: no upload"

# 5. upload failure → fail-closed.
EXTRA='export FAKE_S5_CP_MODE=fail'; run_case upload_fail; code=$CODE
nonzero "$code" "upload failure aborts"

# 6. missing required config → fail-closed, no upload.
EXTRA='unset BACKUP_S3_BUCKET'; run_case missing_env; code=$CODE
nonzero "$code" "missing BACKUP_S3_BUCKET aborts"
eq "$(cp_calls | grep -c .)" 0 "missing env: no upload"

# 7. retention: 4 existing + keep 2 → prune the 2 oldest, exit 0.
LS4="$(printf '%s\n' \
  '2024/01/01 00:00:00  10 preprod-t1-20240101T000000Z.sql.gz' \
  '2024/02/01 00:00:00  10 preprod-t2-20240201T000000Z.sql.gz' \
  '2024/03/01 00:00:00  10 preprod-t3-20240301T000000Z.sql.gz' \
  '2024/04/01 00:00:00  10 preprod-t4-20240401T000000Z.sql.gz')"
EXTRA="export BACKUP_RETAIN_COUNT=2; export FAKE_S5_LS=$(printf '%q' "$LS4")"
run_case retention; code=$CODE
eq "$code" 0 "retention: exit 0"
rmd="$(rm_calls)"
echo "$rmd" | grep -q 'preprod-t1-' && ok "retention: pruned oldest t1" || bad "retention: t1 not pruned"
echo "$rmd" | grep -q 'preprod-t2-' && ok "retention: pruned t2" || bad "retention: t2 not pruned"
echo "$rmd" | grep -q 'preprod-t3-' && bad "retention: t3 wrongly pruned" || ok "retention: kept t3"
echo "$rmd" | grep -q 'preprod-t4-' && bad "retention: t4 wrongly pruned" || ok "retention: kept t4 (newest)"

# 8. retention failure is NON-fatal (backup already landed).
EXTRA='export FAKE_S5_LS_MODE=fail'; run_case retention_nonfatal; code=$CODE
eq "$code" 0 "retention failure does not red the release"
eq "$(cp_calls | grep -c .)" 1 "retention_nonfatal: backup still uploaded"

echo ""
echo "PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
