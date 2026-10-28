#!/usr/bin/env bash
# Real released render; each mutation must fail for its own reason, then restore.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CASE_ROOT="$(mktemp -d "$ROOT/tmp/h3-general.XXXXXX")"
trap 'rm -rf "$CASE_ROOT"' EXIT
CHECK="$HERE/check-h3-preprod-render.sh"
GOOD="$CASE_ROOT/general.yaml"
CASE="$CASE_ROOT/case.yaml"
"${KUBECTL:-kubectl}" kustomize "$ROOT/deploy/overlays/preprod" >"$GOOD"
"${KUBECTL:-kubectl}" kustomize --load-restrictor LoadRestrictionsNone "$ROOT/deploy/overlays/preprod" >"$CASE_ROOT/unrestricted.yaml"
cmp "$GOOD" "$CASE_ROOT/unrestricted.yaml"
for entry in 40-immo-mcp-http-deploy.yaml 41-immo-mcp-ingress.yaml; do
  cmp "$ROOT/deploy/k8s/$entry" "$ROOT/deploy/k8s/immo-mcp/$entry"
done
bash "$CHECK" "$GOOD"
PASS=3
reject() {
  local mutation="$1" reason="$2" out
  cp "$GOOD" "$CASE"
  sed -i "$mutation" "$CASE"
  if out="$(bash "$CHECK" "$CASE" 2>&1)"; then echo "FAIL: accepted $reason" >&2; exit 1; fi
  grep -Fq -- "$reason" <<<"$out" || { echo "$out" >&2; exit 1; }
  cp "$GOOD" "$CASE"
  cmp "$GOOD" "$CASE"
  bash "$CHECK" "$CASE" >/dev/null
  echo "ok: rejects $reason; restored render passes"
  PASS=$((PASS + 1))
}
reject '0,/ARTIFACTS_CONTROL_MODE: general/s//ARTIFACTS_CONTROL_MODE: off/' 'API/MCP mismatch or missing ARTIFACTS_CONTROL_MODE'
reject 's/ARTIFACTS_CONTROL_MODE: general/ARTIFACTS_CONTROL_MODE: validation/g' 'expected matching general or off modes'
reject '0,/ARTIFACTS_STORAGE_SCOPE:/s/ARTIFACTS_STORAGE_SCOPE: .*/ARTIFACTS_STORAGE_SCOPE: other/' 'API/MCP mismatch or missing ARTIFACTS_STORAGE_SCOPE'
reject 's/ARTIFACTS_STORAGE_SCOPE: .*/ARTIFACTS_STORAGE_SCOPE: production/g' 'preprod storage namespace required'
reject '/ARTIFACTS_CONTROL_MODE:/a\  ARTIFACTS_VALIDATION_SUBJECTS: fixture' 'general opening has no cohort or window'
reject 's/radar-immobilier-artifacts-preprod/radar-immobilier-docs/g' 'preprod artifact storage coordinates required'
reject 's#https://s3.bhs.io.cloud.ovh.net#http://s3.bhs.io.cloud.ovh.net#g' 'preprod artifact storage coordinates required'
reject 's#ARTIFACTS_READER_AUDIENCE: .*#ARTIFACTS_READER_AUDIENCE: https://immo.sent-tech.ca/reader#' 'preprod reader approval identity required'
reject '/CLASSIFICATION_CURSOR_KEY_ID:/d' 'persistent cursor key ID required'
reject 's/radar-classification-cursor-preprod/ephemeral-cursor/g' 'exact Secret reference required for CLASSIFICATION_CURSOR_SECRET'
reject 's/radar-artifacts-reader-preprod/other-reader/g' 'exact Secret reference required for ARTIFACTS_READER_GRANT_SECRET'
reject 's/key: ARTIFACTS_READER_SESSION_SECRET/key: WRONG/' 'exact Secret reference required for ARTIFACTS_READER_SESSION_SECRET'
reject 's/immo-mcp-artifact-writer/immo-mcp-account-reader/g' 'exact Secret reference required for IMMO_MCP_ARTIFACT_DATABASE_URL'
reject 's/key: IMMO_MCP_ACCOUNT_DATABASE_URL/key: WRONG/' 'exact Secret reference required for IMMO_MCP_ACCOUNT_DATABASE_URL'
reject 's/key: ARTIFACTS_S3_ACCESS_KEY/key: WRONG/g' 'exact Secret reference required for ARTIFACTS_S3_ACCESS_KEY'
reject '/CLASSIFICATION_CURSOR_KEY_ID:/a\  CLASSIFICATION_CURSOR_SECRET: fixture-only' 'credential literal forbidden'
reject '/^  name: radar-artifact-content$/,/^---$/{s/name: radar-api$/name: radar-ui/;}' 'content routes only to the reader API'
reject '/^  name: radar-artifact-content$/,/^---$/{s/name: http$/name: other/;}' 'content reader port must be http'
reject 's/radar-artifact-content-preprod-tls/other-tls/' 'preprod content TLS Secret required'
reject 's/\*.pinned.preprod.immo-pages.sent-tech.ca/\*.wrong.preprod.immo-pages.sent-tech.ca/g' 'content domain/TLS wildcard mismatch'
sed 's/ARTIFACTS_CONTROL_MODE: general/ARTIFACTS_CONTROL_MODE: "off"/g' "$GOOD" >"$CASE"
bash "$CHECK" "$CASE" >/dev/null
echo 'ok: mode-off rollback is accepted for both API and MCP'
PASS=$((PASS + 1))
echo "check-h3-general-render tests: $PASS passed, 0 failed"
bash "$HERE/check-h3-activation-commands.test.sh"
