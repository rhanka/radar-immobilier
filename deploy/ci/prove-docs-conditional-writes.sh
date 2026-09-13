#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C AWS_EC2_METADATA_DISABLED=true

: "${MIGRATION_SOURCE_ACCESS_KEY_ID:?}"
: "${MIGRATION_SOURCE_SECRET_ACCESS_KEY:?}"
: "${MIGRATION_DESTINATION_ACCESS_KEY_ID:?}"
: "${MIGRATION_DESTINATION_SECRET_ACCESS_KEY:?}"
: "${DESTINATION_ENDPOINT:?}" "${DESTINATION_REGION:?}" "${DESTINATION_BUCKET:?}"
: "${PROOF_FILE:?}"
[ ! -e "$PROOF_FILE" ] || {
  echo 'ERROR: conditional-write proof already exists' >&2; exit 2; }
if compgen -G '/evidence/docs-checkpoint/provisional/destination/index-receipt-*.json' \
  >/dev/null; then
  echo 'ERROR: destination inventory already started before proof object' >&2
  exit 2
fi

work="$(mktemp -d /tmp/docs-proof.XXXXXX)"
trap 'rm -rf "$work"' EXIT
printf '[default]\nregion = fr-par\ns3 =\n  addressing_style = path\n' >"$work/source-config"
printf '[default]\nregion = %s\ns3 =\n  addressing_style = virtual\n' \
  "$DESTINATION_REGION" >"$work/destination-config"

source_aws() {
  AWS_ACCESS_KEY_ID="$MIGRATION_SOURCE_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$MIGRATION_SOURCE_SECRET_ACCESS_KEY" \
  AWS_CONFIG_FILE="$work/source-config" aws --no-cli-pager --output json \
    --endpoint-url http://radar-minio:9000 --region fr-par s3api "$@"
}
destination_aws() {
  AWS_ACCESS_KEY_ID="$MIGRATION_DESTINATION_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$MIGRATION_DESTINATION_SECRET_ACCESS_KEY" \
  AWS_CONFIG_FILE="$work/destination-config" aws --no-cli-pager --output json \
    --endpoint-url "$DESTINATION_ENDPOINT" --region "$DESTINATION_REGION" s3api "$@"
}

source_aws list-objects-v2 --bucket radar-immobilier-docs-preprod --max-keys 1 \
  >"$work/list.json" 2>"$work/source-error"
key="$(jq -r '.Contents[0].Key // empty' "$work/list.json")"
[ -n "$key" ] || { echo 'ERROR: DOCS source has no proof candidate' >&2; exit 2; }
source_aws head-object --bucket radar-immobilier-docs-preprod --key "$key" \
  >"$work/source-head.json" 2>"$work/source-error"
source_aws get-object-tagging --bucket radar-immobilier-docs-preprod --key "$key" \
  >"$work/source-tags.json" 2>"$work/source-error"
source_aws get-object --bucket radar-immobilier-docs-preprod --key "$key" \
  "$work/body" >"$work/source-get.json" 2>"$work/source-error"

args=(put-object --bucket "$DESTINATION_BUCKET" --key "$key" --body "$work/body")
for pair in 'ContentType:content-type' 'ContentEncoding:content-encoding' \
  'CacheControl:cache-control' 'ContentDisposition:content-disposition'; do
  field="${pair%%:*}"; option="${pair#*:}"
  value="$(jq -r --arg field "$field" '.[$field] // empty' "$work/source-head.json")"
  [ -z "$value" ] || args+=("--$option" "$value")
done
metadata="$(jq -c '.Metadata // {}' "$work/source-head.json")"
[ "$metadata" = '{}' ] || args+=(--metadata "$metadata")
tagging="$(jq -r '[.TagSet[]? | ((.Key|@uri) + "=" + (.Value|@uri))] | join("&")' \
  "$work/source-tags.json")"
[ -z "$tagging" ] || args+=(--tagging "$tagging")

if destination_aws "${args[@]}" --if-none-match '*' >"$work/create.json" 2>"$work/create-error"; then
  create_result=created
else
  create_result=preexisting
fi
if destination_aws "${args[@]}" --if-none-match '*' >"$work/unexpected.json" \
  2>"$work/if-none-error"; then
  echo 'ERROR: destination accepted duplicate if-none-match create' >&2
  exit 2
fi
grep -Eq 'PreconditionFailed|412' "$work/if-none-error" || {
  echo 'ERROR: destination conditional-create refusal is unproved' >&2; exit 2; }

destination_aws head-object --bucket "$DESTINATION_BUCKET" --key "$key" \
  >"$work/before-head.json" 2>"$work/destination-error"
etag="$(jq -r '.ETag // empty' "$work/before-head.json")"
[ -n "$etag" ] || { echo 'ERROR: destination ETag is absent' >&2; exit 2; }
destination_aws "${args[@]}" --if-match "$etag" >"$work/update.json" \
  2>"$work/if-match-error"
destination_aws get-object --bucket "$DESTINATION_BUCKET" --key "$key" \
  "$work/destination-body" >"$work/destination-get.json" 2>"$work/destination-error"
source_hash="$(sha256sum "$work/body" | awk '{print $1}')"
[ "$source_hash" = "$(sha256sum "$work/destination-body" | awk '{print $1}')" ] || {
  echo 'ERROR: conditional proof object body differs' >&2; exit 2; }

observed="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
expires="$(date -u -d '+24 hours' +%Y-%m-%dT%H:%M:%SZ)"
printf 'bucket=%s\nkeySha256=%s\ncreate=%s\nifNoneMatch=blocked\nifMatch=accepted\nbodySha256=%s\n' \
  "$DESTINATION_BUCKET" "$(printf '%s' "$key" | sha256sum | awk '{print $1}')" \
  "$create_result" "$source_hash" >"$work/transcript"
mkdir -p "$(dirname "$PROOF_FILE")"
jq -n --arg endpoint "$DESTINATION_ENDPOINT" --arg region "$DESTINATION_REGION" \
  --arg bucket "$DESTINATION_BUCKET" \
  --arg identity "$(printf '%s' "$MIGRATION_DESTINATION_ACCESS_KEY_ID" | sha256sum | awk '{print $1}')" \
  --arg observed "$observed" --arg expires "$expires" \
  --arg transcript "$(sha256sum "$work/transcript" | awk '{print $1}')" \
  '{schemaVersion:1,provider:"OVHcloud Object Storage",providerVersion:"S3 BHS 2026-09-13",
    destination:{endpoint:$endpoint,region:$region,bucket:$bucket,pathStyle:false},
    identityFingerprint:$identity,observedAt:$observed,expiresAt:$expires,
    transcriptSha256:$transcript,
    capabilities:{ifNoneMatchCreate:true,ifMatchUpdate:true}}' >"$PROOF_FILE.tmp"
sync -f "$PROOF_FILE.tmp" && mv "$PROOF_FILE.tmp" "$PROOF_FILE"
echo '[object-storage-docs] conditional-write capability and retained source object proved'
