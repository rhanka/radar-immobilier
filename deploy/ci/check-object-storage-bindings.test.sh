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
  .env.example deploy/k8s/30-api.yaml deploy/k8s/refresh-diag/diag-refresh-job.yaml
  deploy/k8s/31-graph-projection-job.yaml deploy/k8s/32-graph-projection-only-job.yaml
  deploy/k8s/33-scrape-job.yaml deploy/k8s/33b-scrape-cities-job.yaml
  deploy/k8s/36-db-migrate-job.yaml deploy/k8s/37-graphify34-apply-job.yaml
  deploy/k8s/38-graphify34-emit-candidates-job.yaml deploy/k8s/39-export-graph-nodes-job.yaml
  deploy/k8s/40-export-gt-designation-events-job.yaml
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

fixture; mkdir -p "$CASE_ROOT/scripts"; touch "$CASE_ROOT/scripts/mount-scw.sh"
run_bad "$CASE_ROOT" 'rejects a restored legacy mount'; rm -rf "$CASE_ROOT"

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
