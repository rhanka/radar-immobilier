#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C AWS_EC2_METADATA_DISABLED=true AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=4

for name in CANONICAL_MANIFEST CANONICAL_DIGEST REPORT_DIR CONDITIONAL_WRITE_PROOF \
  SOURCE_ENDPOINT SOURCE_REGION SOURCE_BUCKET DESTINATION_ENDPOINT DESTINATION_REGION \
  DESTINATION_BUCKET MIGRATION_SOURCE_ACCESS_KEY_ID MIGRATION_SOURCE_SECRET_ACCESS_KEY \
  MIGRATION_DESTINATION_ACCESS_KEY_ID MIGRATION_DESTINATION_SECRET_ACCESS_KEY; do
  [ -n "${!name:-}" ] || { echo "ERROR: $name is required" >&2; exit 2; }
done
work="$(mktemp -d /tmp/canonical-docs.XXXXXX)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$REPORT_DIR/results"
[ "$(sha256sum "$CANONICAL_MANIFEST" | awk '{print $1}')" = "$CANONICAL_DIGEST" ] || {
  echo 'ERROR: canonical manifest digest differs' >&2; exit 2; }
jq -es 'length == 59017 and (map(.size)|add) == 12534514457 and
  ([.[].key] | length == (unique | length)) and
  all(.[]; (.key|type)=="string" and (.size|type)=="number" and
    (.sha256|test("^[0-9a-f]{64}$")) and (.metadata|type)=="object" and (.tags|type)=="array")' \
  "$CANONICAL_MANIFEST" >/dev/null || {
  echo 'ERROR: canonical PROD corpus contract differs' >&2; exit 2; }
identity="$(printf '%s' "$MIGRATION_DESTINATION_ACCESS_KEY_ID" | sha256sum | awk '{print $1}')"
jq -e --arg endpoint "$DESTINATION_ENDPOINT" --arg region "$DESTINATION_REGION" \
  --arg bucket "$DESTINATION_BUCKET" --arg identity "$identity" '
  .schemaVersion == 1 and .destination ==
    {endpoint:$endpoint,region:$region,bucket:$bucket,pathStyle:false} and
  .identityFingerprint == $identity and .capabilities ==
    {ifNoneMatchCreate:true,ifMatchUpdate:true} and .expiresAt > (now|todateiso8601)' \
  "$CONDITIONAL_WRITE_PROOF" >/dev/null || {
  echo 'ERROR: exact destination conditional-write proof is invalid' >&2; exit 2; }
printf '[default]\nregion = %s\ns3 =\n  addressing_style = virtual\n' "$SOURCE_REGION" >"$work/source-config"
printf '[default]\nregion = %s\ns3 =\n  addressing_style = virtual\n' "$DESTINATION_REGION" >"$work/destination-config"
source_aws() {
  AWS_ACCESS_KEY_ID="$MIGRATION_SOURCE_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$MIGRATION_SOURCE_SECRET_ACCESS_KEY" \
    AWS_CONFIG_FILE="$work/source-config" aws --no-cli-pager --output json \
    --endpoint-url "$SOURCE_ENDPOINT" --region "$SOURCE_REGION" s3api "$@"
}
destination_aws() {
  AWS_ACCESS_KEY_ID="$MIGRATION_DESTINATION_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$MIGRATION_DESTINATION_SECRET_ACCESS_KEY" \
    AWS_CONFIG_FILE="$work/destination-config" aws --no-cli-pager --output json \
    --endpoint-url "$DESTINATION_ENDPOINT" --region "$DESTINATION_REGION" s3api "$@"
}
copy_one() {
  local item="$1" index="$2" result="$REPORT_DIR/results/$index.json"
  local key size hash body="$work/body-$index" observed="$work/observed-$index" etag
  local metadata tagging field option value
  local -a args
  key="$(jq -r '.key' <<<"$item")"; size="$(jq -r '.size' <<<"$item")"; hash="$(jq -r '.sha256' <<<"$item")"
  if destination_aws get-object --bucket "$DESTINATION_BUCKET" --key "$key" "$observed" \
    >"$work/dest-$index.json" 2>"$work/dest-$index.err"; then
    if [ "$(wc -c <"$observed")" -eq "$size" ] &&
      [ "$(sha256sum "$observed" | awk '{print $1}')" = "$hash" ]; then
      rm -f "$observed"; jq -cn --arg key "$key" --argjson size "$size" \
        '{status:"matching",key:$key,size:$size}' >"$result"; return
    fi
    rm -f "$observed"; jq -cn --arg key "$key" --argjson size "$size" \
      '{status:"failed",reason:"destination-conflict",key:$key,size:$size}' >"$result"; return
  fi
  grep -Eq '404|NoSuchKey|Not Found' "$work/dest-$index.err" || {
    jq -cn --arg key "$key" --argjson size "$size" \
      '{status:"failed",reason:"destination-read",key:$key,size:$size}' >"$result"; return; }
  if ! source_aws get-object --bucket "$SOURCE_BUCKET" --key "$key" "$body" \
    >"$work/source-$index.json" 2>"$work/source-$index.err" ||
    [ "$(wc -c <"$body" 2>/dev/null || echo -1)" -ne "$size" ] ||
    [ "$(sha256sum "$body" 2>/dev/null | awk '{print $1}')" != "$hash" ]; then
    rm -f "$body"; jq -cn --arg key "$key" --argjson size "$size" \
      '{status:"failed",reason:"canonical-source",key:$key,size:$size}' >"$result"; return
  fi
  args=(put-object --bucket "$DESTINATION_BUCKET" --key "$key" --body "$body" --if-none-match '*')
  for pair in 'contentType:content-type' 'contentEncoding:content-encoding' \
    'cacheControl:cache-control' 'contentDisposition:content-disposition'; do
    field="${pair%%:*}"; option="${pair#*:}"; value="$(jq -r --arg field "$field" '.[$field] // empty' <<<"$item")"
    [ -z "$value" ] || args+=("--$option" "$value")
  done
  metadata="$(jq -c '.metadata' <<<"$item")"; [ "$metadata" = '{}' ] || args+=(--metadata "$metadata")
  tagging="$(jq -r '[.tags[]? | ((.Key|@uri) + "=" + (.Value|@uri))] | join("&")' <<<"$item")"
  [ -z "$tagging" ] || args+=(--tagging "$tagging")
  if ! destination_aws "${args[@]}" >"$work/put-$index.json" 2>"$work/put-$index.err"; then
    rm -f "$body"; jq -cn --arg key "$key" --argjson size "$size" \
      '{status:"failed",reason:"conditional-put",key:$key,size:$size}' >"$result"; return
  fi
  rm -f "$body"
  if ! destination_aws get-object --bucket "$DESTINATION_BUCKET" --key "$key" "$observed" \
    >"$work/verify-$index.json" 2>"$work/verify-$index.err" ||
    [ "$(wc -c <"$observed" 2>/dev/null || echo -1)" -ne "$size" ] ||
    [ "$(sha256sum "$observed" 2>/dev/null | awk '{print $1}')" != "$hash" ]; then
    rm -f "$observed"; jq -cn --arg key "$key" --argjson size "$size" \
      '{status:"failed",reason:"post-copy-read",key:$key,size:$size}' >"$result"; return
  fi
  rm -f "$observed"; etag="$(jq -r '.ETag // empty' "$work/verify-$index.json")"
  jq -cn --arg key "$key" --arg etag "$etag" --argjson size "$size" \
    '{status:"copied",key:$key,size:$size,etag:$etag}' >"$result"
}

index=0; failures=0; batch=0; pids=(); results=()
while IFS= read -r item; do
  index=$((index + 1)); batch=$((batch + 1)); copy_one "$item" "$index" & pids+=("$!"); results+=("$REPORT_DIR/results/$index.json")
  if [ "$batch" -eq 32 ]; then
    for pid in "${pids[@]}"; do wait "$pid" || true; done
    failures=$((failures + $(jq -s 'map(select(.status=="failed"))|length' "${results[@]}")))
    [ "$failures" -lt 20 ] || break; batch=0; pids=(); results=()
  fi
done <"$CANONICAL_MANIFEST"
for pid in "${pids[@]}"; do wait "$pid" || true; done
jq -cs 'sort_by(.key)' "$REPORT_DIR"/results/*.json >"$REPORT_DIR/copy-ledger.json"
jq -n --arg canonicalDigest "$CANONICAL_DIGEST" --argjson results "$(cat "$REPORT_DIR/copy-ledger.json")" '
  {schemaVersion:1,canonicalDigest:$canonicalDigest,expected:59017,
   matching:([$results[]|select(.status=="matching")]|length),
   copied:([$results[]|select(.status=="copied")]|length),
   failed:([$results[]|select(.status=="failed")]|length),complete:(($results|length)==59017 and all($results[];.status!="failed"))}' \
  >"$REPORT_DIR/summary.json"
jq -e '.complete == true' "$REPORT_DIR/summary.json" >/dev/null
