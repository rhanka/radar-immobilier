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
run_ok "preprod :50 is 50 min after prod and 5 h 10 before the next prod start (real daily starts)"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "30 5,11,17 * * *"#' "$CASE_ROOT/$PRE"
run_bad "preprod hours diverge from prod" "refresh overlay parity failed"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "25 5,11,17,23 * * *"#' "$CASE_ROOT/$PRE"
run_ok "another minute far enough away passes (relational, not pinned)"

fixture; sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "17 5,11,17,23 * * *"#' "$CASE_ROOT/$PRE"
run_bad "17 minutes apart, but a stalled pod outlives the gap" "not before the other environment starts"

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

fixture; sed -i '/^            app.kubernetes.io\/instance: radar-refresh-pv$/d' "$CASE_ROOT/$BASE"
sed -i '0,/^    app.kubernetes.io\/component: graph-projection$/s//&\n    app.kubernetes.io\/instance: radar-refresh-pv/' "$CASE_ROOT/$BASE"
run_bad "selector label moved to the CronJob metadata (not on the pods)" "refresh pending watchdog contract failed"

fixture; sed -i '/^            app.kubernetes.io\/instance: radar-refresh-pv$/d' "$CASE_ROOT/$BASE"
sed -i 's/^  jobTemplate:$/&\n    metadata:\n      labels:\n        app.kubernetes.io\/instance: radar-refresh-pv/' "$CASE_ROOT/$BASE"
run_bad "selector label moved to the Job template metadata (not on the pods)" "refresh pending watchdog contract failed"

fixture; sed -i 's#value: "900" }#value: "59" }#' "$CASE_ROOT/$DOG"
run_bad "watchdog deadline below the 60 s floor the script enforces" "refresh pending watchdog contract failed"

fixture; sed -i 's#value: "900" }#value: "60" }#' "$CASE_ROOT/$DOG"
run_ok "watchdog deadline at the 60 s floor passes"

fixture; sed -i 's#schedule: "0 5,11,17,23 \* \* \*"#schedule: "0 * * * *"#' "$CASE_ROOT/$BASE"
sed -i 's#value: "30 5,11,17,23 \* \* \*"#value: "30 * * * *"#' "$CASE_ROOT/$PRE"
run_bad "hourly schedules (slot timing not checkable) are refused" "refresh stagger failed"

# refresh-stagger.awk alone, on minimal renders: adjacent hours make a real
# cross-hour proximity (preprod 04:50, prod 05:00) that the overlays cannot reach.
stagger_case() { # $1 preprod schedule, $2 prod schedule
  local dir; dir="$(mktemp -d)"; CASES+=("$dir")
  local dog='kind: CronJob
metadata:
  name: radar-refresh-pending-watchdog
spec:
  schedule: "*/5 * * * *"
            - name: REFRESH_PENDING_DEADLINE_SECONDS
              value: "900"'
  printf 'kind: CronJob\nmetadata:\n  name: radar-refresh-pv\nspec:\n  schedule: "%s"\n---\n%s\n' "$1" "$dog" >"$dir/preprod.yaml"
  printf 'kind: CronJob\nmetadata:\n  name: radar-refresh-pv\nspec:\n  schedule: "%s"\n' "$2" >"$dir/prod.yaml"
  awk -v min_minutes=15 -f "$HERE/refresh-stagger.awk" "$dir/preprod.yaml" "$dir/prod.yaml" 2>&1
}
out="$(stagger_case "50 4,5 * * *" "0 4,5 * * *")" && bad "adjacent hours: preprod 04:50 vs prod 05:00 (passed)" \
  || { grep -Fq "closest prod and preprod starts are 10 min apart" <<<"$out" && ok "adjacent hours: preprod 04:50 vs prod 05:00 refused" || bad "adjacent hours (got: $out)"; }
out="$(stagger_case "30 4,5 * * *" "0 4,5 * * *")" && ok "adjacent hours 30 min apart pass" || bad "adjacent hours 30 min apart (got: $out)"
out="$(stagger_case "30 5,11 * * *" "0 5,24 * * *")" && bad "hour 24 accepted" \
  || { grep -Fq "hour list 0-23" <<<"$out" && ok "hour outside 0-23 refused" || bad "hour 24 (got: $out)"; }

echo "verify-renders tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
