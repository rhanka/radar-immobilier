#!/usr/bin/env bash
# Mutation tests for check-prod-configmap-keys.sh (offline, no cluster).
# Each case copies deploy/k8s into a scratch root, applies one mutation and
# asserts the gate verdict. Needs kubectl (render only) and jq.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
GATE="$HERE/check-prod-configmap-keys.sh"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

fresh() {
  rm -rf "$SCRATCH/root"
  mkdir -p "$SCRATCH/root/deploy"
  cp -a "$ROOT/deploy/k8s" "$SCRATCH/root/deploy/k8s"
  mkdir -p "$SCRATCH/root/deploy/overlays"
  cp -a "$ROOT/deploy/overlays/preprod" "$SCRATCH/root/deploy/overlays/preprod"
}
expect() { # expect pass|fail <label>
  if bash "$GATE" check "$SCRATCH/root" >"$SCRATCH/out" 2>&1; then got=pass; else got=fail; fi
  [ "$got" = "$1" ] && ok "$2" || { bad "$2 (got $got)"; sed 's/^/    /' "$SCRATCH/out" >&2; }
}
API="$SCRATCH/root/deploy/k8s/30-api.yaml"
MCP="$SCRATCH/root/deploy/k8s/immo-mcp/40-immo-mcp-http-deploy.yaml"
LIST="$SCRATCH/root/deploy/k8s/prod-configmap-keys.json"

fresh; expect pass "repository sources carry every required key"

fresh; sed -i '/^  ARTIFACTS_S3_BUCKET:/d' "$API"
expect fail "radar-api without ARTIFACTS_S3_BUCKET is refused"

fresh; sed -i '/^  CLASSIFICATION_CURSOR_KEY_ID:/d' "$API"
expect fail "radar-api without CLASSIFICATION_CURSOR_KEY_ID is refused"

fresh; sed -i '/^  IMMO_ARTIFACTS_LIVE_QUALIFIED:/d' "$MCP"
expect fail "immo-mcp-config without IMMO_ARTIFACTS_LIVE_QUALIFIED is refused"

fresh; sed -i 's/^  RADAR_API_BASE_URL:.*/  RADAR_API_BASE_URL: ""/' "$MCP"
expect fail "an empty required value is refused"

fresh; sed -i 's/^  PORT: "3000"$/  PORT: "3000"\n  UNLISTED_KEY: "x"/' "$API"
expect fail "a key outside the list is refused"

fresh; sed -i 's/^  PORT: "3000"$/  PORT: "3000"\n  ARTIFACTS_READER_GRANT_SECRET: "x"/' "$API"
jq '.["radar-api"] += ["ARTIFACTS_READER_GRANT_SECRET"]' "$LIST" > "$LIST.new" && mv "$LIST.new" "$LIST"
expect fail "a credential-like key is refused even when listed"

fresh; jq '.["immo-mcp-config"] = []' "$LIST" > "$LIST.new" && mv "$LIST.new" "$LIST"
expect fail "an empty key list is refused (no vacuous pass)"

fresh
if bash "$GATE" extract "$SCRATCH/cm.yaml" "$SCRATCH/root" >/dev/null 2>&1 \
  && [ "$(grep -c '^kind: ConfigMap$' "$SCRATCH/cm.yaml")" = 2 ] \
  && [ "$(grep -c '^kind: ' "$SCRATCH/cm.yaml")" = 2 ] \
  && grep -q '^  CLASSIFICATION_CURSOR_KEY_ID: preprod-v1$' "$SCRATCH/cm.yaml"; then
  ok "extract writes the two ConfigMaps only"
else bad "extract writes the two ConfigMaps only"; fi

if env -u KUBECONFIG bash "$GATE" diff "$SCRATCH/root" >/dev/null 2>&1; then
  bad "diff refuses to run without an explicit KUBECONFIG"
else ok "diff refuses to run without an explicit KUBECONFIG"; fi

# check-h3-preprod-render.sh: the listed prod keys are allowed in the
# production base, any other ARTIFACTS_ entry still counts as a leak.
H3="$HERE/check-h3-preprod-render.sh"
fresh
if bash "$H3" "$SCRATCH/root" >"$SCRATCH/out" 2>&1 || ! grep -q "leaked into the production base" "$SCRATCH/out"; then
  ok "H3 gate accepts the listed prod artifact keys in the base"
else bad "H3 gate accepts the listed prod artifact keys in the base"; fi
fresh; sed -i "s/^  PORT: \"3000\"$/  PORT: \"3000\"\n  ARTIFACTS_VALIDATION_UNTIL: \"2099-01-01T00:00:00Z\"/" "$API"
bash "$H3" "$SCRATCH/root" >"$SCRATCH/out" 2>&1
if grep -q "leaked into the production base" "$SCRATCH/out"; then
  ok "H3 gate still refuses an unlisted ARTIFACTS_ key in the base"
else bad "H3 gate still refuses an unlisted ARTIFACTS_ key in the base"; fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
