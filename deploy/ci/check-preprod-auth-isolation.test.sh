#!/usr/bin/env bash
# Offline tests for check-preprod-auth-isolation.sh: the released preprod
# overlay passes, and each reinjected regression (starting with the #738 state:
# auth keys inherited from the PROD base) is rejected. Needs kubectl (render
# only, no cluster).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CHECK="$HERE/check-preprod-auth-isolation.sh"
API_PATCH=deploy/overlays/preprod/patch-radar-api-auth.yaml
REC_PATCH=deploy/overlays/preprod/patch-radar-sentropic-auth.yaml
BASE_API=deploy/k8s/30-api.yaml
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
  CASE_ROOT="$(mktemp -d)"
  (cd "$ROOT" && cp -r --parents deploy/k8s deploy/overlays/preprod "$CASE_ROOT")
}

run_ok "$ROOT" 'accepts the released preprod overlay (Ingress routing host exempt)'

fixture; run_ok "$CASE_ROOT" 'accepts an unmodified fixture copy'; rm -rf "$CASE_ROOT"

# The #738 regression: no auth override, radar-api inherits the PROD base.
fixture; sed -i '/^data:/,$d' "$CASE_ROOT/$API_PATCH"
run_bad "$CASE_ROOT" 'rejects the #738 state (radar-api auth keys inherited from PROD)' 'ConfigMap/radar-api: PROD client id'; rm -rf "$CASE_ROOT"

fixture; sed -i '/SENTROPIC_OAUTH_REDIRECT_URI:/d' "$CASE_ROOT/$API_PATCH"
run_bad "$CASE_ROOT" 'rejects a single auth key falling back to the PROD base' 'PROD auth host -> SENTROPIC_OAUTH_REDIRECT_URI'; rm -rf "$CASE_ROOT"

fixture; sed -i '/AUTH_CALLBACK_BASE_URL:/d' "$CASE_ROOT/$API_PATCH"
run_bad "$CASE_ROOT" 'rejects the PROD callback base (AUTH_CALLBACK_BASE_URL)' 'PROD auth host -> AUTH_CALLBACK_BASE_URL'; rm -rf "$CASE_ROOT"

fixture; sed -i '/^data:/,$d' "$CASE_ROOT/$REC_PATCH"
run_bad "$CASE_ROOT" 'rejects PROD values in ConfigMap radar-sentropic-auth' 'ConfigMap/radar-sentropic-auth: PROD auth host'; rm -rf "$CASE_ROOT"

# Exact PROD client id with preprod hosts everywhere: only rule 2 can see it.
fixture; sed -i 's/SENTROPIC_OAUTH_CLIENT_ID: "radar-immobilier-preprod"/SENTROPIC_OAUTH_CLIENT_ID: "radar-immobilier"/' "$CASE_ROOT/$REC_PATCH"
run_bad "$CASE_ROOT" 'rejects the PROD client id in any ConfigMap' 'ConfigMap/radar-sentropic-auth: PROD client id'; rm -rf "$CASE_ROOT"

fixture; sed -i 's#"https://preprod.auth.sent-tech.ca/.well-known/openid-configuration"#"https://AUTH.SENT-TECH.CA/.well-known/openid-configuration"#' "$CASE_ROOT/$REC_PATCH"
run_bad "$CASE_ROOT" 'rejects a PROD IdP host regardless of case' 'PROD auth host -> SENTROPIC_IDP_DISCOVERY_URL'; rm -rf "$CASE_ROOT"

# Future drift: a new auth key added to the base that the overlay does not pin.
fixture; sed -i '/SESSION_ABSOLUTE_TTL_SECONDS:/a\  SENTROPIC_IDP_JWKS_URI: "https://auth.sent-tech.ca/.well-known/jwks.json"' "$CASE_ROOT/$BASE_API"
run_bad "$CASE_ROOT" 'rejects a new base auth key left at its PROD value' 'PROD auth host -> SENTROPIC_IDP_JWKS_URI'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/^          env:$/{s#^          env:$#          env:\n            - name: APP_BASE_URL\n              value: "https://immo.sent-tech.ca"#}' "$CASE_ROOT/$BASE_API"
run_bad "$CASE_ROOT" 'rejects a PROD app host as a workload env literal' 'Deployment/radar-api: PROD auth host'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/^          env:$/{s#^          env:$#          env:\n            - name: SENTROPIC_OAUTH_CLIENT_ID\n              value: radar-immobilier#}' "$CASE_ROOT/$BASE_API"
run_bad "$CASE_ROOT" 'rejects the PROD client id as a workload env literal' 'Deployment/radar-api: PROD client id (env)'; rm -rf "$CASE_ROOT"

fixture; sed -i 's#https://preprod.immo.sent-tech.ca/api/v1/auth/oauth/callback#https://preprod.immo.sent-tech.ca/callback#' "$CASE_ROOT/$API_PATCH"
run_bad "$CASE_ROOT" 'rejects a radar-api redirect_uri that differs from the registered one' '(expected https://preprod.immo.sent-tech.ca/api/v1/auth/oauth/callback)'; rm -rf "$CASE_ROOT"

EMPTY="$(mktemp)"
run_bad "$EMPTY" 'rejects a render without ConfigMap radar-api (no vacuous pass)' 'not found in the render'; rm -f "$EMPTY"

fixture; sed -i 's#path: patch-radar-api-auth.yaml#path: missing-patch.yaml#' "$CASE_ROOT/deploy/overlays/preprod/kustomization.yaml"
run_bad "$CASE_ROOT" 'rejects an overlay that does not render' 'cannot render'; rm -rf "$CASE_ROOT"

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
