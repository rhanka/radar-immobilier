#!/usr/bin/env bash
# Hermetic tests for `refresh-018.mk verify-renders`: the released overlays pass,
# and each mutation of a copy fails for its own reason only.
#
# Covered: the prod/preprod start-minute stagger (incident 2026-10-09), the shared
# hours, the pending-pod watchdog CronJob and its coupling with the refresh pod
# (label selector, Job prefix, backoffLimit 0).
#
# Usage: bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/../../.." && pwd)"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

CASES=()
trap 'rm -rf "${CASES[@]}"' EXIT
fixture() {
  CASE_ROOT="$(mktemp -d)"; CASES+=("$CASE_ROOT")
  mkdir -p "$CASE_ROOT/deploy/k8s"
  cp "$SRC"/deploy/k8s/34-refresh-cronjob.yaml "$SRC"/deploy/k8s/34-refresh-keyring-pvc.yaml \
     "$SRC"/deploy/k8s/34-refresh-pending-watchdog.yaml "$CASE_ROOT/deploy/k8s/"
  cp -r "$SRC/deploy/k8s/refresh-cronjobs" "$SRC/deploy/k8s/refresh-cronjobs-prod" "$CASE_ROOT/deploy/k8s/"
}
verify() { make --no-print-directory -f "$CASE_ROOT/deploy/k8s/refresh-cronjobs/refresh-018.mk" verify-renders ENV=test-refresh-renders 2>&1; }
run_ok() { local out; out="$(verify)" && ok "$1" || { bad "$1"; printf '%s\n' "$out" | tail -5 >&2; }; }
run_bad() {
  local out
  out="$(verify)" && { bad "$1 (passed)"; return; }
  grep -Fq "$2" <<<"$out" && ok "$1" || { bad "$1 (expected: $2)"; printf '%s\n' "$out" | tail -5 >&2; }
}
PRE="deploy/k8s/refresh-cronjobs/kustomization.yaml"
PROD="deploy/k8s/refresh-cronjobs-prod/kustomization.yaml"
BASE="deploy/k8s/34-refresh-cronjob.yaml"
DOG="deploy/k8s/34-refresh-pending-watchdog.yaml"

fixture; run_ok "released overlays pass"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "0 5,11,17,23 * * *"#' "$CASE_ROOT/$PRE"
run_bad "preprod and prod on the same minute" "refresh stagger failed"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "10 5,11,17,23 * * *"#' "$CASE_ROOT/$PRE"
run_bad "preprod only 10 minutes after prod" "refresh stagger failed"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "50 5,11,17,23 * * *"#' "$CASE_ROOT/$PRE"
run_bad "preprod 10 minutes before the next prod start (cyclic)" "refresh stagger failed"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "30 5,11,17 * * *"#' "$CASE_ROOT/$PRE"
run_bad "preprod hours diverge from prod" "refresh overlay parity failed"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "25 5,11,17,23 * * *"#' "$CASE_ROOT/$PRE"
run_ok "another minute far enough away passes (relational, not pinned)"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "45 5,11,17,23 * * *"#' "$CASE_ROOT/$PRE"
run_bad "15 minutes apart, but a stalled pod outlives the gap" "not before the other environment starts"

fixture; sed -i '/34-refresh-pending-watchdog.yaml/d' "$CASE_ROOT/$PROD"
run_bad "prod render without the watchdog" "refresh pending watchdog contract failed"

fixture; sed -i '/name: radar-refresh-pending-watchdog/,/value: false/s/value: false/value: true/' "$CASE_ROOT/$PRE"
run_bad "preprod watchdog left suspended" "refresh pending watchdog contract failed"

fixture; sed -i '/app.kubernetes.io\/instance: radar-refresh-pv/d' "$CASE_ROOT/$BASE"
run_bad "refresh pod without the watchdog selector label" "refresh pending watchdog contract failed"

fixture; sed -i 's#value: "app.kubernetes.io/instance=radar-refresh-pv"#value: "app.kubernetes.io/instance=other"#' "$CASE_ROOT/$DOG"
run_bad "watchdog selecting another label" "refresh pending watchdog contract failed"

fixture; sed -i '/REFRESH_PENDING_DEADLINE_SECONDS/d' "$CASE_ROOT/$DOG"
run_bad "watchdog without its pending deadline" "refresh pending watchdog contract failed"

fixture; sed -i 's#value: "900" }#value: "19800" }#' "$CASE_ROOT/$DOG"
run_bad "watchdog deadline not shorter than the slot stagger" "refresh pending watchdog contract failed"

fixture; sed -i '0,/      backoffLimit: 0/s//      backoffLimit: 1/' "$CASE_ROOT/$BASE"
run_bad "refresh Job retrying a deleted pod" "refresh pending watchdog contract failed"

echo "verify-renders tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
