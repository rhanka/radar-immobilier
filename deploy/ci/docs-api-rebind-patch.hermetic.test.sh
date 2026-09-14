#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
patch="$root/deploy/k8s/object-storage-docs-prod/api-rebind-patch.yaml"
binding="$root/deploy/ci/docs-api-ovh-binding.jq"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

jq -n '{
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: {name: "radar-api", namespace: "radar-immobilier"},
  spec: {selector: {matchLabels: {app: "radar-api"}}, template: {
    metadata: {labels: {app: "radar-api"}},
    spec: {containers: [{name: "api", image: "example.invalid/radar-api:test", env:
      (["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE",
        "S3_ACCESS_KEY", "S3_SECRET_KEY"] | map({name: ., value: "legacy"}))
    }]}
  }}
}' >"$work/legacy.json"

kubectl patch --local=true --type=strategic -f "$work/legacy.json" \
  --patch-file "$patch" -o json >"$work/rendered.json"

jq -e -f "$binding" "$work/rendered.json" >/dev/null
jq -e '
  [.spec.template.spec.containers[] | select(.name == "api") | .env[] |
    select(.name | startswith("S3_"))] as $bindings |
  ($bindings | length) == 6 and all($bindings[];
    (has("value") | not) and (.valueFrom.secretKeyRef.name == "radar-docs-s3-credentials"))
' "$work/rendered.json" >/dev/null

jq '(.spec.template.spec.containers[] | select(.name == "api") | .env[] |
  select(.name == "S3_ENDPOINT")).value = "legacy"' \
  "$work/rendered.json" >"$work/invalid.json"
if jq -e -f "$binding" "$work/invalid.json" >/dev/null; then
  echo 'FAIL: API binding accepted a legacy literal alongside valueFrom' >&2
  exit 1
fi

echo 'PROD DOCS API rebind patch: PASS'
