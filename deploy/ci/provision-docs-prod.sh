#!/usr/bin/env bash
set -euo pipefail

: "${KUBECONFIG:?}" "${OVH_CLOUD_PROJECT_ID:?}"
OVHCLOUD="${OVHCLOUD:-$HOME/.local/bin/ovhcloud}"
KUBECTL="${KUBECTL:-kubectl}"
NAMESPACE=radar-immobilier
BUCKET=radar-immobilier-docs
SECRET=radar-docs-s3-credentials
DESCRIPTION=immo-docs-prod-rw-no-delete-radar-immobilier-docs-20260913

[ "${OBJECT_STORAGE_DOCS_PROD_PROVISION_CONFIRM:-}" = 1 ] || {
  echo 'ERROR: explicit PROD DOCS provisioning confirmation is required' >&2
  exit 2
}
command -v "$OVHCLOUD" >/dev/null
command -v "$KUBECTL" >/dev/null
command -v jq >/dev/null

bucket_json="$($OVHCLOUD cloud storage object get "$BUCKET" \
  --cloud-project "$OVH_CLOUD_PROJECT_ID" -o json)"
jq -e --arg bucket "$BUCKET" '
  .name == $bucket and .region == "BHS" and .objectsCount == 0
' <<<"$bucket_json" >/dev/null || {
  echo 'ERROR: exact empty OVH PROD DOCS bucket is unproved' >&2
  exit 2
}

if $KUBECTL -n "$NAMESPACE" get "secret/$SECRET" >/dev/null 2>&1; then
  $KUBECTL -n "$NAMESPACE" get "secret/$SECRET" -o json |
    jq -e -f deploy/ci/validate-docs-secret.jq >/dev/null
  echo '[object-storage-docs-prod] Secret already exists and has the exact key family'
  exit 0
fi

quota="$($KUBECTL -n "$NAMESPACE" get resourcequota/tenant-quota -o json)"
jq -e '(.status.used.secrets | tonumber) < (.status.hard.secrets | tonumber)' \
  <<<"$quota" >/dev/null || {
  echo 'ERROR: PROD Secret quota has no headroom' >&2
  exit 2
}

users="$($OVHCLOUD cloud user list --cloud-project "$OVH_CLOUD_PROJECT_ID" -o json)"
matches="$(jq --arg description "$DESCRIPTION" \
  '[.[] | select(.description == $description)] | length' <<<"$users")"
[ "$matches" -le 1 ] || {
  echo 'ERROR: duplicate dedicated PROD DOCS identities exist' >&2
  exit 2
}
if [ "$matches" -eq 1 ]; then
  user_id="$(jq -r --arg description "$DESCRIPTION" \
    '.[] | select(.description == $description) | .id' <<<"$users")"
else
  user_json="$($OVHCLOUD cloud user create --cloud-project "$OVH_CLOUD_PROJECT_ID" \
    --roles objectstore_operator --description "$DESCRIPTION" -o json)"
  user_id="$(jq -er '.id' <<<"$user_json")"
fi

for _ in {1..12}; do
  user_json="$($OVHCLOUD cloud user get "$user_id" \
    --cloud-project "$OVH_CLOUD_PROJECT_ID" -o json)"
  [ "$(jq -r '.status' <<<"$user_json")" = ok ] && break
  sleep 5
done
[ "$(jq -r '.status' <<<"$user_json")" = ok ] || {
  echo 'ERROR: dedicated PROD DOCS identity did not become ready' >&2
  exit 2
}

policy="$(jq -cn --arg bucket "$BUCKET" '{Statement:[{
  Sid:"RWNoDeleteProdDocs",Effect:"Allow",
  Action:["s3:GetObject","s3:GetObjectTagging","s3:PutObject",
    "s3:PutObjectTagging","s3:ListBucket","s3:ListMultipartUploadParts",
    "s3:ListBucketMultipartUploads","s3:AbortMultipartUpload",
    "s3:GetBucketLocation"],
  Resource:[("arn:aws:s3:::"+$bucket),("arn:aws:s3:::"+$bucket+"/*")]
}]}')"
$OVHCLOUD cloud user s3-policy create "$user_id" \
  --cloud-project "$OVH_CLOUD_PROJECT_ID" --policy "$policy" -o json >/dev/null

old_credentials="$($OVHCLOUD cloud storage object credentials list "$user_id" \
  --cloud-project "$OVH_CLOUD_PROJECT_ID" -o json)"
credential="$($OVHCLOUD cloud storage object credentials create "$user_id" \
  --cloud-project "$OVH_CLOUD_PROJECT_ID" -o json)"
access="$(jq -er '.access' <<<"$credential")"
secret="$(jq -er '.secret' <<<"$credential")"
cleanup=true
cleanup_credential() {
  if $cleanup; then
    $OVHCLOUD cloud storage object credentials delete "$user_id" "$access" \
      --cloud-project "$OVH_CLOUD_PROJECT_ID" -o json >/dev/null 2>&1 || true
  fi
  unset access secret credential
}
trap cleanup_credential EXIT

$KUBECTL -n "$NAMESPACE" create secret generic "$SECRET" \
  --from-literal=DOCS_S3_ACCESS_KEY="$access" \
  --from-literal=DOCS_S3_SECRET_KEY="$secret" \
  --from-literal=DOCS_S3_ENDPOINT=https://s3.bhs.io.cloud.ovh.net \
  --from-literal=DOCS_S3_REGION=bhs \
  --from-literal=DOCS_S3_BUCKET="$BUCKET" \
  --from-literal=DOCS_S3_FORCE_PATH_STYLE=false >/dev/null
cleanup=false
for stale in $(jq -r '.[].access' <<<"$old_credentials"); do
  $OVHCLOUD cloud storage object credentials delete "$user_id" "$stale" \
    --cloud-project "$OVH_CLOUD_PROJECT_ID" -o json >/dev/null
done
trap - EXIT
unset access secret credential
echo "[object-storage-docs-prod] dedicated identity $user_id and Secret committed"
