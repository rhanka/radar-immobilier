#!/usr/bin/env bash
set -euo pipefail

resources=deploy/ci/minio-removal-resources.jq
pods=deploy/ci/minio-removal-pods.jq
receipt=deploy/ci/minio-removal-receipt.jq

jq -e -f "$resources" <<<'{"items":[]}' >/dev/null
jq -e -f "$pods" <<<'{"items":[]}' >/dev/null

partial='{"items":[{"kind":"Service","metadata":{"name":"radar-minio","uid":"service-uid"},"spec":{"selector":{"app.kubernetes.io/component":"minio","app.kubernetes.io/name":"radar-immobilier"}}}]}'
jq -e -f "$resources" <<<"$partial" >/dev/null

invalid='{"items":[{"kind":"Service","metadata":{"name":"radar-minio"},"spec":{"selector":{"app.kubernetes.io/component":"api"}}}]}'
if jq -e -f "$resources" <<<"$invalid" >/dev/null; then
  echo 'FAIL: mismatched remaining MinIO resource accepted' >&2
  exit 1
fi

consumer='{"items":[{"metadata":{"name":"consumer"},"status":{"phase":"Running"},"spec":{"volumes":[{"persistentVolumeClaim":{"claimName":"minio-data-radar-minio-0"}}]}}]}'
if jq -e -f "$pods" <<<"$consumer" >/dev/null; then
  echo 'FAIL: active MinIO PVC consumer accepted' >&2
  exit 1
fi

jq -n --arg observedAt 2026-09-13T00:00:00Z '{items:[]}' | \
  jq -e --arg observedAt 2026-09-13T00:00:00Z -f "$receipt" | \
  jq -e '.schemaVersion == 2 and (.resources | length) == 9 and
    all(.resources[]; .present == false and .uid == null) and
    .canonicalRecovery.manifestSha256 ==
      "52646a7b56c16b912f889c9d8dec471ec0eadd0eb77de9b70056315c10ef0425"' >/dev/null

echo 'preprod MinIO resumable removal contract: PASS'
