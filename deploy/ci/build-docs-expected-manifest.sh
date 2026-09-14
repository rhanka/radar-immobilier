#!/usr/bin/env bash
set -euo pipefail

: "${CHECKPOINT_DIR:?}" "${FENCE_FILE:?}" "${EXPECTED_MANIFEST:?}"
proof="$CHECKPOINT_DIR/final-inventory.json"
source_manifest="$CHECKPOINT_DIR/fenced/source/manifest.jsonl"
[ -s "$proof" ] && [ -s "$source_manifest" ] && [ -s "$FENCE_FILE" ] || {
  echo 'ERROR: finalized fenced DOCS inventory is absent' >&2; exit 2; }
jq -e '.toolComplete == true and .fenceValidated == false and
  .providerEnforcementValidated == false' "$proof" >/dev/null
companion_count="$(jq -s 'map(select(.bucket == "radar-immobilier-docs")) |
  map(.objects) | unique | if . == [0] then 0 else -1 end' \
  /evidence/docs-companion-empty/*.json)"
[ "$companion_count" = 0 ] || {
  echo 'ERROR: empty companion DOCS source proof is absent or contradictory' >&2; exit 2; }

manifest_hash="$(sha256sum "$source_manifest" | awk '{print $1}')"
fence_hash="$(sha256sum "$FENCE_FILE" | awk '{print $1}')"
observed="$(awk -F= '$1 == "observedAt" {print $2}' "$FENCE_FILE")"
[ -n "$observed" ] || { echo 'ERROR: DOCS fence timestamp is absent' >&2; exit 2; }
primary='{"endpoint":"http://radar-minio:9000","region":"fr-par","bucket":"radar-immobilier-docs-preprod","pathStyle":true}'
companion='{"endpoint":"http://radar-minio:9000","region":"fr-par","bucket":"radar-immobilier-docs","pathStyle":true}'
mkdir -p "$(dirname "$EXPECTED_MANIFEST")"
jq -n --slurpfile objects "$source_manifest" --argjson primary "$primary" \
  --argjson companion "$companion" --arg observed "$observed" \
  --arg manifest "$manifest_hash" --arg fence "$fence_hash" \
  --arg empty "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" '
  {schemaVersion:1,
   sources:[
     ($primary + {observedAt:$observed,manifestSha256:$manifest,fenceSha256:$fence}),
     ($companion + {observedAt:$observed,manifestSha256:$empty,fenceSha256:$fence})],
   objects:[$objects[] | . + {sources:[$primary]}]}' >"$EXPECTED_MANIFEST.tmp"
sync -f "$EXPECTED_MANIFEST.tmp" && mv "$EXPECTED_MANIFEST.tmp" "$EXPECTED_MANIFEST"
echo '[object-storage-docs] expected union manifest committed'
