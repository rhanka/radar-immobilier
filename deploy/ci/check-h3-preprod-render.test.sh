#!/usr/bin/env bash
# Offline tests for check-h3-preprod-render.sh: the released preprod overlay
# passes disabled, and each reinjected regression is rejected for its own
# reason. Needs kubectl (render only, no cluster).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CHECK="$HERE/check-h3-preprod-render.sh"
ACTIVATE="$HERE/check-h3-activation-render.sh"
DENY=deploy/overlays/preprod/artifact-content-deny.yaml
INGRESS=deploy/overlays/preprod/artifact-content-ingress.yaml
NETPOL=deploy/overlays/preprod/artifact-content-networkpolicy.yaml
CONTROL=deploy/overlays/preprod/patch-artifacts-control.yaml
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
run_ok() { bash "$CHECK" "$1" >/dev/null 2>&1 && ok "$2" || bad "$2"; }
# A regression must be rejected FOR THE EXPECTED REASON ($3 = message fragment):
# a no-op sed or an unrelated breakage must not count as a pass.
run_bad() {
  local out
  if out="$(bash "$CHECK" "$1" 2>&1)"; then bad "$2 (accepted)"; return; fi
  grep -Fq -- "$3" <<<"$out" && ok "$2" || bad "$2 (rejected without: $3)"
}
fixture() {
  mkdir -p "$ROOT/tmp"
  CASE_ROOT="$(mktemp -d "$ROOT/tmp/h3-disabled.XXXXXX")"
  (cd "$ROOT" && cp -r --parents deploy/k8s deploy/overlays/preprod "$CASE_ROOT")
}
trap 'rm -rf "${CASE_ROOT:-}"' EXIT

run_ok "$ROOT" 'accepts the released preprod overlay (activation disabled)'

fixture; sed -i 's/ARTIFACTS_CONTROL_MODE: "off"/ARTIFACTS_CONTROL_MODE: "validation"/' "$CASE_ROOT/$CONTROL"
run_bad "$CASE_ROOT" 'rejects a control mode other than off by default' 'expected off: no activation by default'; rm -rf "$CASE_ROOT"

fixture; sed -i '/ARTIFACTS_CONTROL_MODE:/a\  ARTIFACTS_S3_BUCKET: "invented-bucket"' "$CASE_ROOT/$CONTROL"
run_bad "$CASE_ROOT" 'rejects an invented storage value' 'ARTIFACTS_S3_BUCKET must stay absent'; rm -rf "$CASE_ROOT"

fixture; sed -i 's#args: \["content-deny"\]#args: ["content-deny"]\n          command: ["sh"]#' "$CASE_ROOT/$DENY"
run_bad "$CASE_ROOT" 'rejects a command: override bypassing entrypoint validation' 'bypasses entrypoint validation'; rm -rf "$CASE_ROOT"

fixture; sed -i 's/name: radar-artifact-content-deny/name: radar-api/' "$CASE_ROOT/$INGRESS"
run_bad "$CASE_ROOT" 'rejects content routing to the api Service' 'only to the denial Service'; rm -rf "$CASE_ROOT"

fixture; sed -i 's/name: deny-content-deny-egress/name: deny-content-deny-egress-x/' "$CASE_ROOT/$NETPOL"
run_bad "$CASE_ROOT" 'rejects a missing deny-all egress policy' 'deny-content-deny-egress not found'; rm -rf "$CASE_ROOT"

fixture
if out="$(bash "$ACTIVATE" "$CASE_ROOT" 2>&1)"; then bad 'activation gate accepts the committed render (unfilled)'; else
  grep -Fq -- "unfilled content-domain placeholder" <<<"$out" && ok 'activation gate refuses the unfilled placeholder' || bad 'activation gate refuses the unfilled placeholder'
fi
rm -rf "$CASE_ROOT"

fixture; sed -i 's#path: patch-radar-api-auth.yaml#path: missing-patch.yaml#' "$CASE_ROOT/deploy/overlays/preprod/kustomization.yaml"
run_bad "$CASE_ROOT" 'rejects an overlay that does not render' 'cannot render'; rm -rf "$CASE_ROOT"

echo "check-h3-preprod-render tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
