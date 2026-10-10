#!/usr/bin/env bash
# Offline tests for projection-declared-args.sh (GH #817): the run-job inputs of a
# projection with declared changes become exactly the script flags, or are refused
# for the expected reason; no declaration ⇒ empty flags (unchanged projection).
# Also checks that run-job.yaml and both projection manifests carry the wiring.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CHECK="$HERE/projection-declared-args.sh"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

# expect_out <name> <cities> <declarations> <mode> <expected stdout>
expect_out() {
  local out
  if ! out="$(PROJECT_CITIES="$2" DECLARATIONS="$3" MODE="$4" bash "$CHECK" 2>&1)"; then bad "$1 (refused: $out)"; return; fi
  [ "$out" = "$5" ] && ok "$1" || bad "$1 (got '$out', expected '$5')"
}
# expect_refused <name> <cities> <declarations> <mode> <message fragment>
expect_refused() {
  local out
  if out="$(PROJECT_CITIES="$2" DECLARATIONS="$3" MODE="$4" bash "$CHECK" 2>&1)"; then bad "$1 (accepted: '$out')"; return; fi
  grep -Fq -- "$5" <<<"$out" && ok "$1" || bad "$1 (refused without '$5': $out)"
}

B21="desg-evt-vente-taxes,lot-3521520,signal-subdiv-3520533,source-brigham-html-pv-budget-2026-01-22,source-brigham-html-pv-2026-02-03,bylaw-06-102,lot-3520533,lot-6715717,source-brigham-html-pv-2026-03-03,lot-3522133,signal-subdiv-3521520,source-brigham-html-pv-2026-01-22-extra,signal-derogation-ppcmoi-brigham,desg-evt-subdiv-3520533,lot-6519613,bylaw-2026-01-circ,lot-6715283,lot-6715284,lot-6715716,desg-evt-subdiv-3521520,bylaw-2025-05"

# No declaration: nothing changes, whatever the cities or the mode.
expect_out "empty declarations ⇒ no flag" "sherbrooke ogden" "" "preview" ""
expect_out "blank declarations ⇒ no flag" "" "   " "apply" ""
expect_out "no declaration ignores an odd mode" "x" "" "whatever" ""

# The brigham operation.
expect_out "brigham preview" "brigham" "remove=${B21} lose=muni-brigham:flag" "preview" \
  "--remove=${B21} --lose=muni-brigham:flag --preview"
expect_out "brigham apply" " brigham " "remove=${B21} lose=muni-brigham:flag" "apply" \
  "--remove=${B21} --lose=muni-brigham:flag"
expect_out "clause order is free, flags are not" "brigham" "lose=muni-brigham:flag  remove=a,b" "apply" \
  "--remove=a,b --lose=muni-brigham:flag"
expect_out "removals only" "clermont--charlevoix-est" "remove=a" "apply" "--remove=a"
expect_out "losses only" "x" "lose=a:k,b:k2" "preview" "--lose=a:k,b:k2 --preview"

# Refusals.
expect_refused "two cities" "brigham danville" "remove=a" "apply" "exactly one city"
expect_refused "no city" "" "remove=a" "apply" "exactly one city"
expect_refused "bad slug" "Brigham" "remove=a" "apply" "invalid city slug"
expect_refused "bad mode" "brigham" "remove=a" "dry" "recovery_mode must be preview or apply"
expect_refused "unknown clause" "brigham" "delete=a" "apply" "unknown clause"
expect_refused "repeated clause" "brigham" "remove=a remove=b" "apply" "more than once"
expect_refused "empty list" "brigham" "remove=" "apply" "invalid remove list"
expect_refused "shell substitution" "brigham" 'remove=$(id)' "apply" "invalid remove list"
expect_refused "semicolon" "brigham" "remove=a;b" "apply" "invalid remove list"
expect_refused "sed delimiter" "brigham" "remove=a#b" "apply" "invalid remove list"
expect_refused "ampersand" "brigham" "remove=a&b" "apply" "invalid remove list"
expect_refused "slash" "brigham" "remove=a/b" "apply" "invalid remove list"
expect_refused "newline" "brigham" $'remove=a\nlose=b:k' "apply" "single line"
expect_refused "empty id" "brigham" "remove=a,,b" "apply" "invalid remove list"
expect_refused "leading dash id" "brigham" "remove=-a" "apply" "invalid remove list"
expect_refused "loss without key" "brigham" "lose=a" "apply" "invalid lose list"
expect_refused "loss key with dash" "brigham" "lose=a:k-1" "apply" "invalid lose list"
expect_refused "duplicate removal" "brigham" "remove=a,b,a" "apply" "duplicate"
expect_refused "duplicate loss" "brigham" "lose=a:k,a:k" "apply" "duplicate"
expect_refused "removed and losing" "brigham" "remove=a lose=a:k" "apply" "both removed and losing"
many="$(printf 'n-%s,' $(seq 1 65))"
expect_refused "65 removals" "brigham" "remove=${many%,}" "apply" "at most 64"
many="$(printf 'n-%s:k,' $(seq 1 17))"
expect_refused "17 losses" "brigham" "lose=${many%,}" "apply" "at most 16"
expect_refused "too long" "brigham" "remove=$(printf 'a%.0s' $(seq 1 4100))" "apply" "4096"

# Wiring.
WF="$ROOT/.github/workflows/run-job.yaml"
grep -Fq 'bash deploy/ci/projection-declared-args.sh' "$WF" && ok "run-job calls the validator" || bad "run-job does not call the validator"
grep -Fq 's#__PROJECTION_ARGS__#${projection_args}#' "$WF" && ok "run-job renders __PROJECTION_ARGS__" || bad "run-job does not render __PROJECTION_ARGS__"
grep -Eq "__\(IMAGE\|[A-Z_|]*PROJECTION_ARGS" "$WF" && ok "run-job refuses an unrendered __PROJECTION_ARGS__" || bad "unrendered-placeholder check misses __PROJECTION_ARGS__"
for m in deploy/k8s/32-graph-projection-only-job.yaml deploy/k8s/graph-projection-preprod/job.yaml; do
  grep -Fq 'node dist/scripts/project-graph-from-s3.js __PROJECTION_ARGS__ __PROJECT_CITIES__' "$ROOT/$m" \
    && ok "$m passes __PROJECTION_ARGS__" || bad "$m lacks __PROJECTION_ARGS__"
done

echo "projection-declared-args: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
