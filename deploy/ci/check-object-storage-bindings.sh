#!/usr/bin/env bash
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
GRAPH_FILES=(
  deploy/k8s/31-graph-projection-job.yaml
  deploy/k8s/32-graph-projection-only-job.yaml
  deploy/k8s/37-graphify34-apply-job.yaml
  deploy/k8s/38-graphify34-emit-candidates-job.yaml
  deploy/k8s/39-export-graph-nodes-job.yaml
  deploy/k8s/40-export-gt-designation-events-job.yaml
)
SCRAPE_FILES=(deploy/k8s/33-scrape-job.yaml deploy/k8s/33b-scrape-cities-job.yaml)
FILES=("${GRAPH_FILES[@]}" "${SCRAPE_FILES[@]}" deploy/k8s/36-db-migrate-job.yaml)
PENDING_CLIENTS=(
  deploy/k8s/32b-reproject-etape-job.yaml
  deploy/k8s/refresh-diag/diag-refresh-job.yaml
  .github/workflows/grounding-preprod.yml
  .github/workflows/grounding-publish-prod.yml
  .github/workflows/run-job.yaml
)
FAIL=0
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

binding() {
  local rel="$1" var="$2" ref_kind="$3" resource="$4" key="$5" block
  block="$(awk -v var="$var" '
    $0 ~ "^[[:space:]]*- name: " var "[[:space:]]*$" { found=1; print; next }
    found && $0 ~ "^[[:space:]]*- name: " { exit }
    found { print }
  ' "$ROOT/$rel")"
  [ -n "$block" ] || { fail "$rel missing $var"; return; }
  grep -Fq 'valueFrom:' <<<"$block" || fail "$rel $var is not a reference"
  grep -Eq '^[[:space:]]+value:[[:space:]]' <<<"$block" && fail "$rel $var mixes or uses value"
  grep -Fq "$ref_kind:" <<<"$block" || fail "$rel $var is not a $ref_kind"
  grep -Fq "name: $resource" <<<"$block" || fail "$rel $var uses the wrong resource"
  grep -Fq "key: $key" <<<"$block" || fail "$rel $var uses the wrong key"
  grep -Eq 'optional:[[:space:]]*true' <<<"$block" && fail "$rel $var is optional"
}

for rel in "${GRAPH_FILES[@]}"; do
  for suffix in ENDPOINT BUCKET REGION FORCE_PATH_STYLE; do
    binding "$rel" "GRAPH_S3_$suffix" configMapKeyRef radar-api "GRAPH_S3_$suffix"
  done
  for suffix in ACCESS_KEY SECRET_KEY; do
    binding "$rel" "GRAPH_S3_$suffix" secretKeyRef radar-graph-s3-credentials "GRAPH_S3_$suffix"
  done
done
for rel in "${SCRAPE_FILES[@]}"; do
  for suffix in ENDPOINT BUCKET REGION FORCE_PATH_STYLE; do
    binding "$rel" "SCRAPE_S3_$suffix" configMapKeyRef radar-api "SCRAPE_S3_$suffix"
  done
  for suffix in ACCESS_KEY SECRET_KEY; do
    binding "$rel" "SCRAPE_S3_$suffix" secretKeyRef radar-scrape-s3-credentials "SCRAPE_S3_$suffix"
  done
  grep -Eiq 'radar-graph-s3-credentials|sentropic-geo|GEO_[A-Z0-9_]*S3' "$ROOT/$rel" &&
    fail "$rel reuses a GRAPH or Geo identity for DOCS"
done

for rel in "${FILES[@]}"; do
  grep -Eiq 's3\.fr-par\.scw\.cloud|radar-minio|radar-immobilier-docs-pocs|sentropic-geo|GEO_DOCUMENTS_S3' "$ROOT/$rel" && fail "$rel contains a forbidden storage literal"
  grep -Eq 'optional:[[:space:]]*true|radar-s3-credentials' "$ROOT/$rel" && fail "$rel retains an optional or generic credential fallback"
done
for suffix in ENDPOINT BUCKET REGION FORCE_PATH_STYLE ACCESS_KEY SECRET_KEY; do
  binding deploy/k8s/30-api.yaml "S3_$suffix" secretKeyRef \
    radar-docs-s3-credentials "DOCS_S3_$suffix"
done
grep -Eiq 's3\.fr-par\.scw\.cloud|radar-minio|radar-immobilier-docs-pocs' \
  "$ROOT/deploy/k8s/30-api.yaml" && fail 'deploy/k8s/30-api.yaml retains a legacy storage binding'
grep -Eiq 's3\.fr-par\.scw\.cloud|radar-minio|radar-immobilier-docs-pocs|radar-s3-credentials|optional:[[:space:]]*true' \
  "$ROOT/deploy/k8s/34-refresh-cronjob.yaml" && fail 'deploy/k8s/34-refresh-cronjob.yaml retains a legacy storage binding'
grep -Fq 'name: radar-refresh-pv' "$ROOT/deploy/k8s/34-refresh-cronjob.yaml" ||
  fail 'deploy/k8s/34-refresh-cronjob.yaml lost radar-refresh-pv'

for rel in scripts/mount-scw.sh scripts/umount-scw.sh; do
  [ ! -e "$ROOT/$rel" ] || fail "$rel must be retired"
done
[ ! -e "$ROOT/deploy/k8s/25-minio.yaml" ] || fail 'deploy/k8s/25-minio.yaml must be retired'
for rel in deploy/k8s/kustomization.yaml deploy/k8s/70-networkpolicy.yaml; do
  grep -Eiq 'radar-minio|component:[[:space:]]*minio|25-minio\.yaml' "$ROOT/$rel" &&
    fail "$rel retains a PROD MinIO resource"
done
for rel in "${PENDING_CLIENTS[@]}"; do
  [ -f "$ROOT/$rel" ] || fail "$rel is missing from the explicit pending-client ledger"
done
for expected in \
  'S3_ENDPOINT=http://minio:9000' \
  'S3_REGION=fr-par' \
  'S3_BUCKET=radar-immobilier-raw' \
  'S3_ACCESS_KEY=minioadmin' \
  'S3_SECRET_KEY=minioadmin'; do
  grep -Fqx "$expected" "$ROOT/.env.example" || fail ".env.example local setting changed: $expected"
done
grep -Fq 'value: "http://radar-minio:9000"' "$ROOT/deploy/k8s/refresh-diag/diag-refresh-job.yaml" || fail 'refresh diagnostic binding changed'
grep -Fq 'SCW_TEM_API_BASE_URL: "https://api.scaleway.com"' "$ROOT/deploy/k8s/30-api.yaml" || fail 'TEM configuration changed'
grep -Fq 'name: radar-tem-credentials' "$ROOT/deploy/k8s/30-api.yaml" || fail 'TEM Secret reference changed'

if [ "$FAIL" -ne 0 ]; then
  echo "object-storage binding check: $FAIL failure(s)" >&2
  exit 1
fi
echo "object-storage binding check: ok (${#FILES[@]} released manifests)"
echo "object-storage pending-client ledger: ${#PENDING_CLIENTS[@]} gated surfaces"
