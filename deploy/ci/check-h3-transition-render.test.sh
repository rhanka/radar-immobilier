#!/usr/bin/env bash
# Synthetic operator states: COPY, expected failure, restore, cmp, pass.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
mkdir -p "$ROOT/tmp"
CASE_ROOT="$(mktemp -d "$ROOT/tmp/h3-transition.XXXXXX")"
trap 'rm -rf "$CASE_ROOT"' EXIT
export TMPDIR="$CASE_ROOT"
CHECK="$HERE/check-h3-preprod-render.sh"
GOOD="$CASE_ROOT/good.yaml"
CASE="$CASE_ROOT/case.yaml"
"${KUBECTL:-kubectl}" kustomize --load-restrictor LoadRestrictionsNone "$ROOT/deploy/overlays/preprod" >"$CASE_ROOT/disabled.yaml"
cp "$CASE_ROOT/disabled.yaml" "$GOOD"
sed -i '/ARTIFACTS_CONTROL_MODE:/a\  ARTIFACTS_CONTENT_BASE: pages.fixture.test\n  ARTIFACTS_STORAGE_SCOPE: fixture_scope\n  ARTIFACTS_ORG_ID: fixture_org\n  ARTIFACTS_S3_BUCKET: fixture-bucket\n  ARTIFACTS_S3_ENDPOINT: https://s3.fixture.test\n  ARTIFACTS_S3_REGION: fixture-region\n  ARTIFACTS_VALIDATION_SUBJECTS: fixture_subject\n  ARTIFACTS_VALIDATION_UNTIL: "2099-01-01T00:00:00Z"' "$GOOD"
sed -i -e 's/artifacts-content-unverified.invalid/pages.fixture.test/g' \
  -e 's/radar-artifact-content-unverified-tls/fixture-content-tls/g' \
  -e "s#radar-api:latest#radar-api@sha256:$(printf 'a%.0s' {1..64})#g" \
  -e "s#radar-ui:[^ ]*#radar-ui@sha256:$(printf 'b%.0s' {1..64})#g" "$GOOD"
cp "$GOOD" "$CASE_ROOT/preparation.yaml"
sed 's/ARTIFACTS_CONTROL_MODE: "off"/ARTIFACTS_CONTROL_MODE: validation/' "$GOOD" >"$CASE_ROOT/activation.yaml"
PASS=0
accept() {
  make --no-print-directory -C "$ROOT" -f tools/artifact-host.mk "check-h3-$1-render" H3_RENDER="$2" ENV=test-h3-transition
  PASS=$((PASS + 1))
}
reject() {
  local phase="$1" mutation="$2" reason="$3" out
  cp "$GOOD" "$CASE"
  sed -i "$mutation" "$CASE"
  if out="$(H3_RENDER_PHASE="$phase" bash "$CHECK" "$CASE" 2>&1)"; then echo "FAIL: accepted $phase: $reason" >&2; exit 1; fi
  grep -Fq -- "$reason" <<<"$out" || { echo "$out" >&2; exit 1; }
  echo "ok: rejects $phase: $reason"
  cp "$GOOD" "$CASE"; cmp "$GOOD" "$CASE"
  H3_RENDER_PHASE="$phase" bash "$CHECK" "$CASE" >/dev/null
  echo 'ok: restored copy passes; cmp identical'
  PASS=$((PASS + 1))
}
accept preparation "$GOOD"
reject preparation 's/ARTIFACTS_CONTROL_MODE: "off"/ARTIFACTS_CONTROL_MODE: validation/' 'expected off'
reject preparation 's/ARTIFACTS_S3_BUCKET: .*/ARTIFACTS_S3_BUCKET: ""/' 'empty or missing ARTIFACTS_S3_BUCKET'
reject preparation 's/pages.fixture.test/artifacts-content-unverified.invalid/g' 'unfilled content-domain placeholder'
reject preparation 's/fixture-content-tls/radar-artifact-content-unverified-tls/' 'unfilled content TLS Secret'
reject preparation 's#radar-api@sha256:[a-f0-9]*#radar-api:latest#g' 'requires image digest pin'
reject preparation 's/2099-01-01/2000-01-01/' 'expired ARTIFACTS_VALIDATION_UNTIL'
reject preparation '/^  name: radar-artifact-content-deny$/,/^---$/{s#radar-api@sha256:[a-f0-9]*#radar-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc#;}' 'denial image differs from api image'
reject preparation '/^  name: allow-traefik-to-content-deny$/,/^---$/{s/^  - Ingress$/  - Ingress\n  - Egress/;s/^spec:$/spec:\n  egress:\n  - {}/;}' 'egress forbidden on denial ingress policy'
# Existing phases still reject a fully configured, off preparation render.
for phase in disabled activation; do
  if H3_RENDER_PHASE="$phase" bash "$CHECK" "$GOOD" >"$CASE_ROOT/$phase.log" 2>&1; then exit 1; fi
  echo "ok: preparation cannot pass $phase gate"; PASS=$((PASS + 1))
done
# H2 keeps the content base and H3 denial image, but no activation group.
sed -i '/^  ARTIFACTS_/ { /ARTIFACTS_CONTENT_BASE:/!d; }' "$GOOD"
sed -i '/        - name: ARTIFACTS_S3_/{N;N;N;N;N;d;}' "$GOOD"
sed -i '/^  name: radar-api$/,/^---$/{s#radar-api@sha256:[a-f0-9]*#radar-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc#;}' "$GOOD"
accept rollback "$GOOD"
for key in CONTROL_MODE STORAGE_SCOPE ORG_ID S3_BUCKET S3_ENDPOINT S3_REGION VALIDATION_SUBJECTS VALIDATION_UNTIL; do
  reject rollback "/ARTIFACTS_CONTENT_BASE:/a\\  ARTIFACTS_$key: fixture" "ARTIFACTS_$key must stay absent"
done
reject rollback '/        - name: POSTGRES_USER/i\        - name: ARTIFACTS_S3_ACCESS_KEY\n          value: fixture' 'unexpected ARTIFACTS env override'
reject rollback 's/name: radar-db-credentials/name: radar-artifacts-preprod/g' 'artifact Secret reference forbidden for H2 rollback'
reject rollback 's/pages.fixture.test/artifacts-content-unverified.invalid/g' 'unfilled content-domain placeholder'
reject rollback 's#radar-api@sha256:[a-f0-9]*#radar-api:latest#g' 'requires image digest pin'
reject rollback '/^  name: allow-traefik-to-content-deny$/,/^---$/{s/^  - Ingress$/  - Ingress\n  - Egress/;s/^spec:$/spec:\n  egress:\n  - {}/;}' 'egress forbidden on denial ingress policy'
cp "$GOOD" "$CASE_ROOT/rollback.yaml"
for phase in disabled preparation activation rollback; do
  cp "$CASE_ROOT/$phase.yaml" "$GOOD"
  H3_RENDER_PHASE="$phase" bash "$CHECK" "$GOOD" >/dev/null
  echo "ok: unmodified $phase render accepted"; PASS=$((PASS + 1))
  reject "$phase" '/^  name: radar-api$/,/^---$/{/        - configMapRef:/i\        - secretRef:\n            name: radar-artifacts-shadow
  }' 'secretRef envFrom forbidden'
  reject "$phase" '/^  name: radar-api$/,/^---$/{/            name: radar-api$/a\        - configMapRef:\n            name: shadow
  }' 'exact api envFrom source required'
  for policy in deny-content-deny-egress allow-traefik-to-content-deny; do
    reject "$phase" "/^  name: $policy$/,/^---$/{/      app.kubernetes.io\/name: radar-immobilier$/a\\      z-isolation: other
    }" 'exact denial podSelector required'
    reject "$phase" "/^  name: $policy$/,/^---$/{/  podSelector:/a\\    matchExpressions:\\n    - key: z-isolation\\n      operator: Exists
    }" 'exact denial podSelector required'
  done
  reject "$phase" '/^  name: radar-artifact-content-deny$/,/^---$/{/        app.kubernetes.io\/name: radar-immobilier$/s/radar-immobilier/other/;}' 'denial pod labels must carry the selector'
done
echo "check-h3-transition-render tests: $PASS passed, 0 failed"
