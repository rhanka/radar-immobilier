#!/usr/bin/env bash
# =============================================================================
# db-backup.test.sh — hermetic tests for run-db-backup.sh (§1(a), B′).
#
# Shims `kubectl` and `s5cmd` on PATH and drives the runner through its
# guarantees. Uses the REAL template + REAL envsubst, so it also verifies the
# render (placeholders resolved, in-container $VARS left literal). The guarantee
# that matters most is FAIL-CLOSED: a failed / timed-out backup Job MUST exit
# non-zero so the release aborts. Run: bash deploy/ci/db-backup.test.sh
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/run-db-backup.sh"
[ -f "$SCRIPT" ] || { echo "cannot find run-db-backup.sh"; exit 2; }

ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok  : $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
eq()   { [ "$1" = "$2" ] && ok "$3" || bad "$3 (want '$2' got '$1')"; }
nz()   { [ "$1" -ne 0 ] && ok "$2 (exit $1)" || bad "$2 (expected non-zero, got 0)"; }

make_bin() {
  local d="$1"; mkdir -p "$d/bin"
  cat > "$d/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
calls="${CALLS_DIR:?}"
verb=""
for a in "$@"; do case "$a" in apply|get|logs|delete) verb="$a"; break;; esac; done
case "$verb" in
  apply)
    [ "${FAKE_APPLY_MODE:-ok}" = fail ] && { echo "apply failed" >&2; exit 1; }
    f=""; prev=""; for a in "$@"; do [ "$prev" = "-f" ] && f="$a"; prev="$a"; done
    [ -n "$f" ] && cp "$f" "$calls/applied.yaml"
    echo "job configured" ;;
  get)
    case " $* " in
      *succeeded*) echo "${FAKE_JOB_SUCCEEDED:-}" ;;
      *failed*)    echo "${FAKE_JOB_FAILED:-}" ;;
      *)           echo "" ;;
    esac ;;
  logs)   echo "(fake job logs)" ;;
  delete) : ;;
esac
exit 0
EOF
  cat > "$d/bin/s5cmd" <<'EOF'
#!/usr/bin/env bash
calls="${CALLS_DIR:?}"
shift 2                 # drop `--endpoint-url <ep>`
cmd="${1:-}"; shift || true
case "$cmd" in
  ls) [ "${FAKE_S5_LS_MODE:-ok}" = fail ] && { echo "ls failed" >&2; exit 1; }; printf '%s\n' "${FAKE_S5_LS:-}" ;;
  rm) echo "$1" >> "$calls/rm" ;;
esac
exit 0
EOF
  chmod +x "$d/bin/kubectl" "$d/bin/s5cmd"
}

CASE_DIR=""; CODE=0
run_case() {
  CASE_DIR="$(mktemp -d "${ROOT}/c.XXXXXX")"; make_bin "$CASE_DIR"
  (
    export PATH="${CASE_DIR}/bin:${PATH}" CALLS_DIR="$CASE_DIR"
    export BACKUP_ENV=preprod BACKUP_TAG=abc1234 NAMESPACE=radar-immobilier-preprod
    export BACKUP_S3_BUCKET=radar-db-backups BACKUP_S3_ENDPOINT=https://s3.fr-par.scw.cloud
    export AWS_ACCESS_KEY_ID=fake-key AWS_SECRET_ACCESS_KEY=fake-secret
    export BACKUP_POLL_INTERVAL=1
    eval "${EXTRA:-}"
    bash "$SCRIPT"
  ) >"${CASE_DIR}/out" 2>&1
  CODE=$?
}
applied() { cat "${CASE_DIR}/applied.yaml" 2>/dev/null || true; }
rm_calls() { cat "${CASE_DIR}/rm" 2>/dev/null || true; }

echo "== run-db-backup.sh (B′) =="

# 1. happy: Job succeeds → exit 0, and the rendered manifest is correct.
EXTRA='export FAKE_JOB_SUCCEEDED=1'; run_case happy; code=$CODE
eq "$code" 0 "happy: exit 0 when job completes"
applied | grep -q 'kind: Job'                                   && ok "render: is a Job"            || bad "render: not a Job"
applied | grep -q 'name: db-backup-preprod-abc1234-'            && ok "render: JOB_NAME substituted" || bad "render: JOB_NAME missing"
applied | grep -q 's3://radar-db-backups/db-backups/preprod-abc1234-.*\.sql\.gz' && ok "render: S3 KEY substituted" || bad "render: KEY missing"
applied | grep -qF '$POSTGRES_USER'                             && ok "render: in-container \$POSTGRES_USER left literal" || bad "render: \$POSTGRES_USER wrongly substituted"
applied | grep -qE '\$\{[A-Za-z_]'                              && bad "render: unresolved \${VAR} placeholder left" || ok "render: no unresolved placeholder"

# 2. Job failed → fail-closed.
EXTRA='export FAKE_JOB_FAILED=1'; run_case job_fail; code=$CODE
nz "$code" "job failure aborts the release"

# 3. Job never completes → timeout → fail-closed.
EXTRA='export BACKUP_WAIT_TIMEOUT=1'; run_case timeout; code=$CODE
nz "$code" "job timeout aborts the release"

# 4. kubectl apply fails → fail-closed.
EXTRA='export FAKE_APPLY_MODE=fail; export FAKE_JOB_SUCCEEDED=1'; run_case apply_fail; code=$CODE
nz "$code" "apply failure aborts"

# 5. missing required config → fail-closed.
EXTRA='unset BACKUP_S3_BUCKET; export FAKE_JOB_SUCCEEDED=1'; run_case missing_env; code=$CODE
nz "$code" "missing BACKUP_S3_BUCKET aborts"

# 6. retention: 4 existing + keep 2 → prune 2 oldest, still exit 0.
LS4="$(printf '%s\n' \
  '2024/01/01 00:00:00  10 preprod-t1-20240101T000000Z.sql.gz' \
  '2024/02/01 00:00:00  10 preprod-t2-20240201T000000Z.sql.gz' \
  '2024/03/01 00:00:00  10 preprod-t3-20240301T000000Z.sql.gz' \
  '2024/04/01 00:00:00  10 preprod-t4-20240401T000000Z.sql.gz')"
EXTRA="export FAKE_JOB_SUCCEEDED=1; export BACKUP_RETAIN_COUNT=2; export FAKE_S5_LS=$(printf '%q' "$LS4")"
run_case retention; code=$CODE
eq "$code" 0 "retention: exit 0"
rmd="$(rm_calls)"
echo "$rmd" | grep -q 'preprod-t1-' && ok "retention: pruned oldest t1" || bad "retention: t1 not pruned"
echo "$rmd" | grep -q 'preprod-t2-' && ok "retention: pruned t2"        || bad "retention: t2 not pruned"
echo "$rmd" | grep -q 'preprod-t3-' && bad "retention: t3 wrongly pruned" || ok "retention: kept t3"
echo "$rmd" | grep -q 'preprod-t4-' && bad "retention: t4 wrongly pruned" || ok "retention: kept t4 (newest)"

# 6b. retention orders CHRONOLOGICALLY (by S3 date), NOT lexically by name. Fixture
#     whose name order (sha-dominated) is INVERTED vs the date order: the
#     date-NEWEST backup (0004) sorts lexically FIRST, the date-OLDEST (zzz1) sorts
#     lexically LAST. A lexical prune would delete 0004 (the newest!); the
#     chronological prune must delete the date-oldest (zzz1, yyy2) and keep 0004.
LS4B="$(printf '%s\n' \
  '2024/01/01 00:00:00  10 preprod-zzz1-20240101T000000Z.sql.gz' \
  '2024/02/01 00:00:00  10 preprod-yyy2-20240201T000000Z.sql.gz' \
  '2024/03/01 00:00:00  10 preprod-b003-20240301T000000Z.sql.gz' \
  '2024/04/01 00:00:00  10 preprod-0004-20240401T000000Z.sql.gz')"
EXTRA="export FAKE_JOB_SUCCEEDED=1; export BACKUP_RETAIN_COUNT=2; export FAKE_S5_LS=$(printf '%q' "$LS4B")"
run_case retention_chrono; code=$CODE
eq "$code" 0 "retention_chrono: exit 0"
rmd="$(rm_calls)"
echo "$rmd" | grep -q 'preprod-zzz1-' && ok "retention_chrono: pruned date-oldest zzz1 (lexically LAST)" || bad "retention_chrono: zzz1 not pruned"
echo "$rmd" | grep -q 'preprod-yyy2-' && ok "retention_chrono: pruned yyy2"                               || bad "retention_chrono: yyy2 not pruned"
echo "$rmd" | grep -q 'preprod-b003-' && bad "retention_chrono: b003 wrongly pruned"                      || ok "retention_chrono: kept b003"
echo "$rmd" | grep -q 'preprod-0004-' && bad "retention_chrono: 0004 (date-newest, lexically FIRST) WRONGLY pruned" || ok "retention_chrono: kept 0004 (date-newest, lexically first)"

# 6c. the CURRENT backup is NEVER pruned, even if it sorts date-oldest (clock-skew
#     belt). Pin the current key's timestamp (TS_KEY) so it is deterministic, then
#     list it as the date-OLDEST object: without the up-front exclusion it would be
#     the first to be dropped. It must survive; the oldest *other* backup is pruned.
CUR_TS=20200101T000000Z   # BACKUP_TAG is abc1234 (run_case default) → cur = preprod-abc1234-<CUR_TS>
LSCUR="$(printf '%s\n' \
  "2020/01/01 00:00:00  10 preprod-abc1234-${CUR_TS}.sql.gz" \
  '2024/02/01 00:00:00  10 preprod-t2-20240201T000000Z.sql.gz' \
  '2024/03/01 00:00:00  10 preprod-t3-20240301T000000Z.sql.gz')"
EXTRA="export FAKE_JOB_SUCCEEDED=1; export BACKUP_RETAIN_COUNT=1; export TS_KEY=${CUR_TS}; export FAKE_S5_LS=$(printf '%q' "$LSCUR")"
run_case retention_excl_cur; code=$CODE
eq "$code" 0 "retention_excl_cur: exit 0"
rmd="$(rm_calls)"
echo "$rmd" | grep -q "preprod-abc1234-${CUR_TS}" && bad "excl_cur: CURRENT key wrongly pruned (date-oldest)" || ok "excl_cur: current key kept despite sorting date-oldest"
echo "$rmd" | grep -q 'preprod-t2-' && ok "excl_cur: pruned oldest OTHER backup t2" || bad "excl_cur: t2 not pruned"
echo "$rmd" | grep -q 'preprod-t3-' && bad "excl_cur: t3 wrongly pruned" || ok "excl_cur: kept t3"

# 7. retention failure is NON-fatal (backup already landed).
EXTRA='export FAKE_JOB_SUCCEEDED=1; export FAKE_S5_LS_MODE=fail'; run_case retention_nonfatal; code=$CODE
eq "$code" 0 "retention failure does not red the release"

echo ""
echo "PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
