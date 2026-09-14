#!/usr/bin/env bash
set -euo pipefail

: "${PROD_MANIFEST:?}" "${PREPROD_MANIFEST:?}" "${OUTPUT_DIR:?}"
[ -s "$PROD_MANIFEST" ] && [ -s "$PREPROD_MANIFEST" ] || {
  echo 'ERROR: both complete DOCS manifests are required' >&2; exit 2; }
mkdir -p "$OUTPUT_DIR"
for manifest in "$PROD_MANIFEST" "$PREPROD_MANIFEST"; do
  jq -es '([.[].key] | length == (unique | length)) and all(.[].size; type == "number")
    and all(.[].sha256; test("^[0-9a-f]{64}$"))' "$manifest" >/dev/null || {
    echo 'ERROR: DOCS manifest is invalid or has duplicate keys' >&2; exit 2; }
done

jq -n --slurpfile prod "$PROD_MANIFEST" --slurpfile preprod "$PREPROD_MANIFEST" '
  def evidence: {size,sha256,etag:(.etag // null)};
  def category:
    if (.key | startswith("baseline-shaset-")) then "baseline-shaset"
    elif (.key | contains("/") | not) then "root"
    else (.key | split("/")[0])
    end;
  def aggregate($items; $side):
    [$items[] | {category:(category),bytes:(if $side == "prod" then
      (.prod.size // 0) else (.preprod.size // 0) end)}]
    | sort_by(.category) | group_by(.category)
    | map({category:.[0].category,objects:length,bytes:(map(.bytes)|add//0)});
  INDEX($prod[]; .key) as $pidx | INDEX($preprod[]; .key) as $qidx |
  ([$prod[] as $p | $qidx[$p.key] as $q |
    if $q == null then {status:"prod-only",key:$p.key,prod:($p|evidence),preprod:null}
    elif $p.size == $q.size and $p.sha256 == $q.sha256 then
      {status:"reusable",key:$p.key,prod:($p|evidence),preprod:($q|evidence)}
    else {status:"conflicting",key:$p.key,prod:($p|evidence),preprod:($q|evidence)} end]
   + [$preprod[] as $q | select($pidx[$q.key] == null) |
      {status:"preprod-only",key:$q.key,prod:null,preprod:($q|evidence)}])
  | sort_by(.key) as $diff
  | {schemaVersion:1,canonical:"prod-scw-docs-pocs",comparison:{
      prodObjects:($prod|length),prodBytes:($prod|map(.size)|add//0),
      preprodObjects:($preprod|length),preprodBytes:($preprod|map(.size)|add//0)},
     counts:($diff | group_by(.status) | map({key:.[0].status,value:length}) | from_entries),
     aggregates:{
       reusable:aggregate([$diff[]|select(.status=="reusable")];"prod"),
       prodOnly:aggregate([$diff[]|select(.status=="prod-only")];"prod"),
       conflicting:aggregate([$diff[]|select(.status=="conflicting")];"prod"),
       preprodOnly:aggregate([$diff[]|select(.status=="preprod-only")];"preprod")},
     objects:$diff}' >"$OUTPUT_DIR/corpus-diff.json.tmp"
sync -f "$OUTPUT_DIR/corpus-diff.json.tmp"
mv "$OUTPUT_DIR/corpus-diff.json.tmp" "$OUTPUT_DIR/corpus-diff.json"
jq -c '.objects[] | select(.status == "reusable")' \
  "$OUTPUT_DIR/corpus-diff.json" >"$OUTPUT_DIR/preprod-reusable.jsonl"
jq -c '.objects[] | select(.status == "prod-only" or .status == "conflicting")' \
  "$OUTPUT_DIR/corpus-diff.json" >"$OUTPUT_DIR/prod-required.jsonl"
cp "$PROD_MANIFEST" "$OUTPUT_DIR/canonical-prod-manifest.jsonl"
find "$OUTPUT_DIR" -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | \
  xargs -0 sha256sum >"$OUTPUT_DIR/SHA256SUMS"
jq '{canonical,comparison,counts,aggregates}' "$OUTPUT_DIR/corpus-diff.json"
