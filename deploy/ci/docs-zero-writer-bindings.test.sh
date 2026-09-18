#!/usr/bin/env bash
set -euo pipefail
filter=deploy/ci/docs-zero-writer-bindings.jq
fixture='{"items":[{"metadata":{"name":"radar-refresh-pv"},"spec":{"jobTemplate":{"spec":{"template":{"spec":{"containers":[{"name":"refresh-pv","env":[{"name":"SCRAPE_S3_ENDPOINT","value":"https://s3.bhs.io.cloud.ovh.net"},{"name":"SCRAPE_S3_BUCKET","value":"radar-immobilier-graph-preprod"},{"name":"SCRAPE_S3_ACCESS_KEY","valueFrom":{"secretKeyRef":{"name":"radar-graph-s3-credentials","key":"GRAPH_S3_ACCESS_KEY"}}},{"name":"SCRAPE_S3_SECRET_KEY","valueFrom":{"secretKeyRef":{"name":"radar-graph-s3-credentials","key":"GRAPH_S3_SECRET_KEY"}}}]}]}}}}}}]}'
jq -e -f "$filter" <<<"$fixture" >/dev/null
reject() {
  if jq -e -f "$filter" >/dev/null; then
    echo 'FAIL: unsafe or absent refresh accepted' >&2
    exit 1
  fi
}
reject <<<'{"items":[]}'
jq '.items[0].spec.jobTemplate.spec.template.spec.containers[0].env[0].value = "http://radar-minio:9000"' <<<"$fixture" | reject
jq '.items[0].spec.jobTemplate.spec.template.spec.containers[0].env[2].valueFrom.secretKeyRef.name = "radar-s3-credentials"' <<<"$fixture" | reject
jq '.items[0].spec.jobTemplate.spec.template.spec.containers[0].env += [.items[0].spec.jobTemplate.spec.template.spec.containers[0].env[0]]' <<<"$fixture" | reject
echo 'docs zero-writer bindings: PASS=5 FAIL=0'
