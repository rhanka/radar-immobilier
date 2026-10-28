#!/usr/bin/env bash
# Hermetic activation gate regressions: synthetic values only, never a cluster.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
mkdir -p "$ROOT/tmp"
CASE_ROOT="$(mktemp -d "$ROOT/tmp/h3-activation.XXXXXX")"
trap 'rm -rf "$CASE_ROOT"' EXIT
export TMPDIR="$CASE_ROOT"
CHECK="$HERE/check-h3-activation-render.sh"
GOOD="$CASE_ROOT/good.yaml"
CASE="$CASE_ROOT/case.yaml"
bash "$HERE/h3-disabled-fixture.sh" "$CASE_ROOT/repo"
"${KUBECTL:-kubectl}" kustomize --load-restrictor LoadRestrictionsNone "$CASE_ROOT/repo/deploy/overlays/preprod" >"$GOOD"
# These domains, IDs and digests belong ONLY to this disposable test render.
sed -i '/ARTIFACTS_CONTROL_MODE:/a\  ARTIFACTS_CONTENT_BASE: pages.fixture.test\n  ARTIFACTS_STORAGE_SCOPE: fixture_scope\n  ARTIFACTS_ORG_ID: fixture_org\n  ARTIFACTS_S3_BUCKET: fixture-bucket\n  ARTIFACTS_S3_ENDPOINT: https://s3.fixture.test\n  ARTIFACTS_S3_REGION: fixture-region\n  ARTIFACTS_VALIDATION_SUBJECTS: fixture_subject\n  ARTIFACTS_VALIDATION_UNTIL: "2099-01-01T00:00:00Z"' "$GOOD"
sed -i -e 's/ARTIFACTS_CONTROL_MODE: "off"/ARTIFACTS_CONTROL_MODE: validation/' \
  -e 's/artifacts-content-unverified.invalid/pages.fixture.test/g' \
  -e 's/radar-artifact-content-unverified-tls/fixture-content-tls/g' \
  -e "s#radar-api:latest#radar-api@sha256:$(printf 'a%.0s' {1..64})#g" \
  -e "s#radar-ui:[^ ]*#radar-ui@sha256:$(printf 'b%.0s' {1..64})#g" "$GOOD"
PASS=0
bash "$CHECK" "$GOOD"
echo 'ok: accepts a complete synthetic activation render'; PASS=$((PASS + 1))
reject() {
  local mutation="$1" reason="$2" out
  cp "$GOOD" "$CASE"
  sed -i "$mutation" "$CASE"
  if out="$(bash "$CHECK" "$CASE" 2>&1)"; then echo "FAIL: accepted $reason" >&2; exit 1; fi
  grep -Fq -- "$reason" <<<"$out" || { echo "$out" >&2; exit 1; }
  echo "ok: rejects $reason"
  cp "$GOOD" "$CASE"
  cmp "$GOOD" "$CASE"
  bash "$CHECK" "$CASE" >/dev/null
  echo 'ok: restored copy passes; cmp identical'
  PASS=$((PASS + 1))
}
reject 's/ARTIFACTS_CONTENT_BASE: .*/ARTIFACTS_CONTENT_BASE: ""/' 'empty or missing ARTIFACTS_CONTENT_BASE'
reject 's/pages.fixture.test/artifacts-content-unverified.invalid/g' 'unfilled content-domain placeholder'
reject 's/fixture-content-tls/radar-artifact-content-unverified-tls/' 'unfilled content TLS Secret'
reject 's/ARTIFACTS_VALIDATION_SUBJECTS: .*/ARTIFACTS_VALIDATION_SUBJECTS: ""/' 'empty or missing ARTIFACTS_VALIDATION_SUBJECTS'
reject 's/2099-01-01/2000-01-01/' 'expired ARTIFACTS_VALIDATION_UNTIL'
reject 's/2099-01-01T00:00:00Z/nonsense/' 'expiration must be UTC ISO-8601'
reject 's#https://s3.fixture.test#http://s3.fixture.test#' 'activation storage endpoint must use HTTPS'
reject 's/ARTIFACTS_S3_BUCKET: .*/ARTIFACTS_S3_BUCKET: ""/' 'empty or missing ARTIFACTS_S3_BUCKET'
reject 's#radar-api@sha256:[a-f0-9]*#radar-api:latest#g' 'activation requires image digest pin'
reject '/^  name: radar-artifact-content-deny$/,/^---$/{s#radar-api@sha256:[a-f0-9]*#radar-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc#;}' 'denial image differs from api image'
reject 's#radar-ui@sha256:[a-f0-9]*#radar-ui:latest#g' 'activation requires image digest pin'
reject 's/namespace: radar-immobilier-preprod/namespace: radar-immobilier/g' 'namespace is not preprod'
reject 's/optional: true/optional: false/g' 'exact optional Secret reference missing'
reject 's/- content-deny/- api/' 'exact content-deny args missing'
reject 's/automountServiceAccountToken: false/automountServiceAccountToken: true/' 'ServiceAccount token mount forbidden'
reject 's/port: 3000/port: 3001/g' 'denial Service port mismatch'
reject 's/name: deny-content-deny-egress/name: removed-egress/' 'deny-content-deny-egress not found'
reject '/^  name: allow-traefik-to-content-deny$/,/^---$/{s/^  - Ingress$/  - Ingress\n  - Egress/;s/^spec:$/spec:\n  egress:\n  - {}/;}' 'egress forbidden on denial ingress policy'
echo "check-h3-activation-render tests: $PASS passed, 0 failed"
