#!/usr/bin/env bash
# Offline tests for check-ops-recipients-render.sh: the released wiring
# passes, and each broken variant (wrong target, missing slug, literal
# audience, prod leak, wrong Secret) is rejected for the expected reason.
# Needs kubectl (render only, no cluster).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CHECK="$HERE/check-ops-recipients-render.sh"
OPS_PATCH=deploy/overlays/preprod/patch-ops-recipients.yaml
BASE_API=deploy/k8s/30-api.yaml
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
run_ok() { bash "$CHECK" "$1" >/dev/null 2>&1 && ok "$2" || bad "$2"; }
run_bad() {
  local out
  if out="$(bash "$CHECK" "$1" 2>&1)"; then bad "$2 (accepted)"; return; fi
  grep -Fq -- "$3" <<<"$out" && ok "$2" || bad "$2 (rejected without: $3)"
}
fixture() {
  CASE_ROOT="$(mktemp -d)"
  (cd "$ROOT" && cp -r --parents deploy/k8s deploy/overlays/preprod "$CASE_ROOT")
}

run_ok "$ROOT" 'accepts the released wiring (preprod open, prod inert)'

fixture; run_ok "$CASE_ROOT" 'accepts an unmodified fixture copy'; rm -rf "$CASE_ROOT"

fixture; sed -i 's/OPS_TARGET: "immo-preprod"/OPS_TARGET: "immo-prod"/' "$CASE_ROOT/$OPS_PATCH"
run_bad "$CASE_ROOT" 'rejects a preprod target of immo-prod' 'OPS_TARGET=immo-prod'; rm -rf "$CASE_ROOT"

fixture; sed -i '/OPS_REFERENCE_WORKSPACE_SLUG/d' "$CASE_ROOT/$OPS_PATCH"
run_bad "$CASE_ROOT" 'rejects a missing reference workspace slug' 'OPS_REFERENCE_WORKSPACE_SLUG=<missing>'; rm -rf "$CASE_ROOT"

fixture; sed -i 's/valueFrom: { secretKeyRef: { name: radar-ops-recipients, key: OPS_RECIPIENTS_AUDIENCE, optional: true } }/value: "literal-audience"/' "$CASE_ROOT/$BASE_API"
run_bad "$CASE_ROOT" 'rejects a literal audience value' 'literal value'; rm -rf "$CASE_ROOT"

fixture; sed -i 's/name: radar-ops-recipients, key: OPS_RECIPIENTS_AUDIENCE/name: radar-other-secret, key: OPS_RECIPIENTS_AUDIENCE/' "$CASE_ROOT/$BASE_API"
run_bad "$CASE_ROOT" 'rejects an audience read from the wrong Secret' 'must read Secret radar-ops-recipients'; rm -rf "$CASE_ROOT"

fixture; sed -i 's/^  PORT: "3000"$/  PORT: "3000"\n  OPS_TARGET: "immo-prod"/' "$CASE_ROOT/$BASE_API"
run_bad "$CASE_ROOT" 'rejects OPS_TARGET leaking into the prod base' 'prod ConfigMap/radar-api must stay inert: OPS_TARGET=immo-prod'; rm -rf "$CASE_ROOT"

echo "check-ops-recipients-render tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
