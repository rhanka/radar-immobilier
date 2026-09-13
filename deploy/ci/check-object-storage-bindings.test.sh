#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CHECK="$HERE/check-object-storage-bindings.sh"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
run_ok() { bash "$CHECK" "$1" >/dev/null 2>&1 && ok "$2" || bad "$2"; }
run_bad() { bash "$CHECK" "$1" >/dev/null 2>&1 && bad "$2" || ok "$2"; }

FILES=(
  .env.example .github/workflows/build-push-images.yml
  deploy/k8s/30-api.yaml
  deploy/k8s/kustomization.yaml deploy/k8s/70-networkpolicy.yaml
  deploy/k8s/31-graph-projection-job.yaml deploy/k8s/32-graph-projection-only-job.yaml
  deploy/k8s/33-scrape-job.yaml deploy/k8s/33b-scrape-cities-job.yaml
  deploy/k8s/36-db-migrate-job.yaml deploy/k8s/37-graphify34-apply-job.yaml
  deploy/k8s/38-graphify34-emit-candidates-job.yaml deploy/k8s/39-export-graph-nodes-job.yaml
  deploy/k8s/40-export-gt-designation-events-job.yaml
  deploy/k8s/32b-reproject-etape-job.yaml deploy/k8s/34-refresh-cronjob.yaml
  deploy/k8s/refresh-cronjobs-prod/kustomization.yaml
  deploy/k8s/10-rbac.yaml deploy/k8s/11-ci-deployer-preprod-rbac.yaml
  deploy/k8s/object-storage-docs-prod/copy-job.yaml
  deploy/k8s/object-storage-docs-prod/fast-inventory-job.yaml deploy/k8s/secrets.example.yaml
  .github/workflows/run-job.yaml
)
fixture() {
  CASE_ROOT="$(mktemp -d)"
  (cd "$ROOT" && cp --parents "${FILES[@]}" "$CASE_ROOT")
}

run_ok "$ROOT" 'accepts the released manifests'

fixture; echo '# https://s3.fr-par.scw.cloud' >>"$CASE_ROOT/deploy/k8s/32-graph-projection-only-job.yaml"
run_bad "$CASE_ROOT" 'rejects a legacy endpoint literal'; rm -rf "$CASE_ROOT"

fixture; sed -i '/- name: GRAPH_S3_ENDPOINT/{n;s/valueFrom:/value: "mixed"\n              valueFrom:/;}' "$CASE_ROOT/deploy/k8s/31-graph-projection-job.yaml"
run_bad "$CASE_ROOT" 'rejects mixed value and valueFrom'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/GRAPH_S3_ACCESS_KEY }/{s/GRAPH_S3_ACCESS_KEY }/GRAPH_S3_ACCESS_KEY, optional: true }/}' "$CASE_ROOT/deploy/k8s/39-export-graph-nodes-job.yaml"
run_bad "$CASE_ROOT" 'rejects optional credentials'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/radar-graph-s3-credentials/{s/radar-graph-s3-credentials/radar-s3-credentials/}' "$CASE_ROOT/deploy/k8s/40-export-gt-designation-events-job.yaml"
run_bad "$CASE_ROOT" 'rejects a generic credential fallback'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/SCRAPE_S3_REGION/{s/SCRAPE_S3_REGION/MISSING_SCRAPE_REGION/}' "$CASE_ROOT/deploy/k8s/33-scrape-job.yaml"
run_bad "$CASE_ROOT" 'rejects an incomplete DOCS binding family'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/radar-scrape-s3-credentials/{s/radar-scrape-s3-credentials/radar-graph-s3-credentials/}' "$CASE_ROOT/deploy/k8s/33b-scrape-cities-job.yaml"
run_bad "$CASE_ROOT" 'rejects DOCS reuse of the GRAPH identity'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/radar-scrape-s3-credentials/{s/radar-scrape-s3-credentials/sentropic-geo-s3-credentials/}' "$CASE_ROOT/deploy/k8s/33b-scrape-cities-job.yaml"
run_bad "$CASE_ROOT" 'rejects DOCS reuse of a Geo identity'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/DOCS_S3_BUCKET/{s/DOCS_S3_BUCKET/S3_BUCKET/}' "$CASE_ROOT/deploy/k8s/30-api.yaml"
run_bad "$CASE_ROOT" 'rejects a generic PROD canonical credential binding'; rm -rf "$CASE_ROOT"

fixture; sed -i '0,/radar-scrape-s3-credentials/{s/radar-scrape-s3-credentials/radar-s3-credentials/}' "$CASE_ROOT/deploy/k8s/34-refresh-cronjob.yaml"
run_bad "$CASE_ROOT" 'rejects a generic refresh credential binding'; rm -rf "$CASE_ROOT"

fixture; sed -i '/name: radar-refresh-pv/d' "$CASE_ROOT/deploy/k8s/34-refresh-cronjob.yaml"
run_bad "$CASE_ROOT" 'preserves the new radar-refresh-pv CronJob'; rm -rf "$CASE_ROOT"

fixture; sed -i '/automountServiceAccountToken/i\imagePullSecrets: [{ name: radar-registry-pull }]' "$CASE_ROOT/deploy/k8s/10-rbac.yaml"
run_bad "$CASE_ROOT" 'rejects a restored SCW image pull secret'; rm -rf "$CASE_ROOT"

fixture; echo 'REFRESH_DIAG_ENABLED' >>"$CASE_ROOT/.github/workflows/build-push-images.yml"
run_bad "$CASE_ROOT" 'rejects a restored MinIO refresh diagnostic'; rm -rf "$CASE_ROOT"

fixture; echo 'image: radar-grounding' >>"$CASE_ROOT/.github/workflows/build-push-images.yml"
run_bad "$CASE_ROOT" 'rejects a restored grounding image build'; rm -rf "$CASE_ROOT"

fixture; touch "$CASE_ROOT/.github/workflows/grounding-preprod.yml"
run_bad "$CASE_ROOT" 'rejects a restored MinIO grounding workflow'; rm -rf "$CASE_ROOT"

fixture; touch "$CASE_ROOT/deploy/k8s/41-grounding-citation-job.yaml"
run_bad "$CASE_ROOT" 'rejects a restored SCW-to-MinIO grounding Job'; rm -rf "$CASE_ROOT"

fixture; mkdir -p "$CASE_ROOT/deploy/k8s/grounding-preprod"; touch "$CASE_ROOT/deploy/k8s/grounding-preprod/kustomization.yaml"
run_bad "$CASE_ROOT" 'rejects a restored MinIO grounding overlay'; rm -rf "$CASE_ROOT"

fixture; touch "$CASE_ROOT/deploy/k8s/72-networkpolicy-grounding-minio-preprod.yaml"
run_bad "$CASE_ROOT" 'rejects a restored MinIO grounding policy'; rm -rf "$CASE_ROOT"

fixture; mkdir -p "$CASE_ROOT/deploy/k8s/refresh-diag"; touch "$CASE_ROOT/deploy/k8s/refresh-diag/diag-refresh-job.yaml"
run_bad "$CASE_ROOT" 'rejects a restored refresh diagnostic manifest'; rm -rf "$CASE_ROOT"

fixture; rm -f "$CASE_ROOT/deploy/k8s/32b-reproject-etape-job.yaml"
run_bad "$CASE_ROOT" 'keeps every gated client explicit'; rm -rf "$CASE_ROOT"

fixture; mkdir -p "$CASE_ROOT/scripts"; touch "$CASE_ROOT/scripts/mount-scw.sh"
run_bad "$CASE_ROOT" 'rejects a restored legacy mount'; rm -rf "$CASE_ROOT"

fixture; touch "$CASE_ROOT/deploy/k8s/25-minio.yaml"
run_bad "$CASE_ROOT" 'rejects a restored PROD MinIO manifest'; rm -rf "$CASE_ROOT"

fixture; sed -i 's/S3_BUCKET=radar-immobilier-raw/S3_BUCKET=changed/' "$CASE_ROOT/.env.example"
run_bad "$CASE_ROOT" 'protects local development settings'; rm -rf "$CASE_ROOT"

echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  bash "$HERE/migrate-object-storage.hermetic.test.sh"
else
  exit 1
fi
