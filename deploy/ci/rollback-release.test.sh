#!/usr/bin/env bash
# =============================================================================
# rollback-release.test.sh — hermetic tests for rollback-release.sh (§1(b)).
#
# Shims `kubectl` and `curl` on PATH. The guarantees under test are the guards:
# G1 (no previous revision → fail-loud, no undo), G2 (not-Ready / unhealthy /
# still-serving-failed → fail-loud), B3 (loud surfacing on success), B5 (one
# shot). Run: bash deploy/ci/rollback-release.test.sh
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/rollback-release.sh"
[ -f "$SCRIPT" ] || { echo "cannot find rollback-release.sh"; exit 2; }

ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok  : $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
eq()  { [ "$1" = "$2" ] && ok "$3" || bad "$3 (want '$2' got '$1')"; }
nz()  { [ "$1" -ne 0 ] && ok "$2 (exit $1)" || bad "$2 (expected non-zero, got 0)"; }

make_bin() {
  local d="$1"; mkdir -p "$d/bin"
  cat > "$d/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
calls="${CALLS_DIR:?}"
sub=""
for a in "$@"; do case "$a" in history|undo|status|get) sub="$a"; break;; esac; done
case "$sub" in
  history)
    n="${FAKE_REVS:-2}"; echo "deployment.apps/x"; echo "REVISION  CHANGE-CAUSE"
    i=1; while [ "$i" -le "$n" ]; do echo "${i}         <none>"; i=$((i+1)); done ;;
  undo)
    echo "undo $*" >> "$calls/undo"
    [ "${FAKE_UNDO_MODE:-ok}" = fail ] && { echo "undo failed" >&2; exit 1; } ;;
  status)
    [ "${FAKE_STATUS_MODE:-ok}" = fail ] && { echo "status timeout" >&2; exit 1; } ;;
  get)  echo "rg.example/radar/img@sha256:deadbeef" ;;
esac
exit 0
EOF
  cat > "$d/bin/curl" <<'EOF'
#!/usr/bin/env bash
url="${@: -1}"
[ "${FAKE_SERVED_MODE:-healthy}" = unhealthy ] && exit 0   # empty body → jq empty → unhealthy
case "$url" in
  */health)     printf '{"sha":"%s"}' "${FAKE_API_SHA:-prevapi}" ;;
  */build.json) printf '{"sha":"%s"}' "${FAKE_UI_SHA:-prevui}" ;;
esac
exit 0
EOF
  chmod +x "$d/bin/kubectl" "$d/bin/curl"
}

CASE_DIR=""; CODE=0
run_case() {
  CASE_DIR="$(mktemp -d "${ROOT}/c.XXXXXX")"; make_bin "$CASE_DIR"
  (
    export PATH="${CASE_DIR}/bin:${PATH}" CALLS_DIR="$CASE_DIR"
    export NAMESPACE=radar-immobilier-preprod PUBLIC_HOST=preprod.immo.example
    export ROLLBACK_ENV=preprod FAILED_REF=deadbee
    export SERVED_POLL_INTERVAL=1
    eval "${EXTRA:-}"
    bash "$SCRIPT"
  ) >"${CASE_DIR}/out" 2>&1
  CODE=$?
}
outp()  { cat "${CASE_DIR}/out" 2>/dev/null || true; }
undos() { cat "${CASE_DIR}/undo" 2>/dev/null || true; }

echo "== rollback-release.sh (§1b) =="

# 1. happy: history≥2, undo+status OK, endpoint healthy & not the failed sha.
EXTRA=''; run_case happy; code=$CODE
eq "$code" 0 "happy: exit 0 on healthy rollback"
outp | grep -q '::warning title=RELEASE ROLLED BACK' && ok "B3: loud surfacing on success" || bad "B3: no loud surfacing"
eq "$(undos | grep -c 'radar-api')" 1 "undo radar-api once"
eq "$(undos | grep -c 'radar-ui')"  1 "undo radar-ui once"

# 2. G1: no previous revision → fail-loud, and NO undo attempted.
EXTRA='export FAKE_REVS=1'; run_case g1; code=$CODE
nz "$code" "G1: no previous revision aborts"
outp | grep -q 'no previous revision' && ok "G1: message names the cause" || bad "G1: no cause message"
eq "$(undos | grep -c .)" 0 "G1: no undo attempted (pre-flight blocks)"

# 3. rollout undo fails → fail-loud.
EXTRA='export FAKE_UNDO_MODE=fail'; run_case undo_fail; code=$CODE
nz "$code" "undo failure aborts"

# 4. G2: rollout status not Ready → fail-loud.
EXTRA='export FAKE_STATUS_MODE=fail'; run_case status_fail; code=$CODE
nz "$code" "G2: not-Ready aborts"

# 5. G2: endpoint never healthy → fail-loud (short served timeout).
EXTRA='export FAKE_SERVED_MODE=unhealthy; export SERVED_CHECK_TIMEOUT=1'; run_case served_unhealthy; code=$CODE
nz "$code" "G2: unhealthy endpoint aborts"

# 6. G2: endpoint still serving the FAILED sha → fail-loud.
EXTRA='export FAKE_API_SHA=deadbee'; run_case still_failed; code=$CODE
nz "$code" "G2: still-serving-failed aborts"
outp | grep -q 'still serves the FAILED build' && ok "G2: names the ineffective-rollback cause" || bad "G2: no cause message"

echo ""
echo "PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
