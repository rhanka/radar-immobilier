#!/usr/bin/env bash

checkpoint_phase() {
  if [ "$FENCE_EVIDENCE_DIGEST" = null ]; then printf provisional; else printf fenced; fi
}

checkpoint_load_index() {
  local side="$1" output="$2" phase dir sequence=1 anchor="" previous="" terminal=false
  local page receipt page_hash receipt_hash count bytes first last truncated coordinate identity
  phase="$(checkpoint_phase)"; dir="$CHECKPOINT_DIR/$phase/$side"; mkdir -p "$dir"
  : >"$output"
  while :; do
    printf -v page '%s/index-page-%06d.jsonl' "$dir" "$sequence"
    printf -v receipt '%s/index-receipt-%06d.json' "$dir" "$sequence"
    if [ -e "$page" ] && [ ! -e "$receipt" ]; then
      rm -f "$page"
    fi
    [ -e "$receipt" ] || break
    [ -r "$page" ] || die "checkpoint page $sequence is missing"
    jq -es --arg anchor "$anchor" '
      [.[].key] as $keys |
      all(.[]; (.key | type) == "string" and (.size | type) == "number") and
      ($keys | length) == ($keys | unique | length) and $keys == ($keys | sort) and
      ($anchor == "" or ($keys | length == 0) or $keys[0] > $anchor)' "$page" >/dev/null ||
      die "checkpoint page $sequence is unordered, duplicated or overlapping"
    page_hash="$(sha256sum "$page" | awk '{print $1}')"
    count="$(jq -s length "$page")"; bytes="$(jq -s 'map(.size) | add // 0' "$page")"
    first="$(jq -sr 'if length == 0 then "" else .[0].key end' "$page")"
    last="$(jq -sr 'if length == 0 then "" else .[-1].key end' "$page")"
    truncated="$(jq -r '.isTruncated' "$receipt")"
    coordinate="$(jq -c ".$side | del(.identityFingerprint)" "$CHECKPOINT_DIR/config.json")"
    identity="$(jq -r ".$side.identityFingerprint" "$CHECKPOINT_DIR/config.json")"
    jq -e --arg side "$side" --argjson sequence "$sequence" --arg anchor "$anchor" \
      --arg first "$first" --arg last "$last" --argjson count "$count" \
      --argjson bytes "$bytes" --arg pageHash "$page_hash" --arg previous "$previous" \
      --argjson coordinate "$coordinate" --arg identity "$identity" \
      --arg config "$(jq -r '.configDigest' "$CHECKPOINT_DIR/config.json")" \
      --arg fence "$FENCE_EVIDENCE_DIGEST" '
      .schemaVersion == 1 and .side == $side and .sequence == $sequence and
      .coordinate == $coordinate and .identityFingerprint == $identity and
      .configDigest == $config and
      .startAfter == (if $anchor == "" then null else $anchor end) and
      .firstKey == (if $first == "" then null else $first end) and
      .lastKey == (if $last == "" then null else $last end) and
      .objects == $count and .bytes == $bytes and .pageManifestSha256 == $pageHash and
      .previousReceiptSha256 == (if $previous == "" then null else $previous end) and
      .fenceEvidenceDigest == (if $fence == "null" then null else $fence end) and
      (.isTruncated | type) == "boolean"' "$receipt" >/dev/null ||
      die "checkpoint receipt $sequence is invalid"
    [ "$count" -gt 0 ] || [ "$truncated" = false ] ||
      die 'checkpoint contains an empty truncated page'
    cat "$page" >>"$output"
    receipt_hash="$(sha256sum "$receipt" | awk '{print $1}')"; previous="$receipt_hash"
    [ -z "$last" ] || anchor="$last"
    sequence=$((sequence + 1))
    if [ "$truncated" = false ]; then terminal=true; break; fi
  done
  local -a pages=("$dir"/index-page-*.jsonl) receipts=("$dir"/index-receipt-*.json)
  [ ! -e "${pages[0]}" ] || [ "${#pages[@]}" -eq "$((sequence - 1))" ] ||
    die 'checkpoint contains non-contiguous pages'
  [ ! -e "${receipts[0]}" ] || [ "${#receipts[@]}" -eq "$((sequence - 1))" ] ||
    die 'checkpoint contains non-contiguous receipts'
  CHECKPOINT_SEQUENCE="$sequence" CHECKPOINT_LAST_KEY="$anchor"
  CHECKPOINT_PREVIOUS_RECEIPT="$previous" CHECKPOINT_TERMINAL="$terminal"
}

checkpoint_commit_page() {
  local side="$1" response="$2" truncated="$3" phase dir base page receipt tmp_page tmp_receipt
  local count bytes first last page_hash coordinate identity
  phase="$(checkpoint_phase)"; dir="$CHECKPOINT_DIR/$phase/$side"
  printf -v base '%06d' "$CHECKPOINT_SEQUENCE"
  page="$dir/index-page-$base.jsonl"; receipt="$dir/index-receipt-$base.json"
  tmp_page="$page.tmp"; tmp_receipt="$receipt.tmp"
  jq -c '.Contents[]? | {key:.Key,size:.Size,etag:(.ETag // "")}' "$response" >"$tmp_page"
  count="$(jq -s length "$tmp_page")"
  [ "$count" -gt 0 ] || [ "$truncated" = false ] || { rm -f "$tmp_page"; return 1; }
  jq -es --arg anchor "$CHECKPOINT_LAST_KEY" '
    [.[].key] as $keys | ($keys | length) == ($keys | unique | length) and
    $keys == ($keys | sort) and ($anchor == "" or ($keys | length == 0) or $keys[0] > $anchor)
  ' "$tmp_page" >/dev/null || { rm -f "$tmp_page"; return 1; }
  bytes="$(jq -s 'map(.size) | add // 0' "$tmp_page")"
  first="$(jq -sr 'if length == 0 then "" else .[0].key end' "$tmp_page")"
  last="$(jq -sr 'if length == 0 then "" else .[-1].key end' "$tmp_page")"
  page_hash="$(sha256sum "$tmp_page" | awk '{print $1}')"
  coordinate="$(jq -c ".$side | del(.identityFingerprint)" "$CHECKPOINT_DIR/config.json")"
  identity="$(jq -r ".$side.identityFingerprint" "$CHECKPOINT_DIR/config.json")"
  jq -n --arg side "$side" --argjson sequence "$CHECKPOINT_SEQUENCE" \
    --argjson coordinate "$coordinate" --arg identity "$identity" \
    --arg start "$CHECKPOINT_LAST_KEY" --arg first "$first" --arg last "$last" \
    --argjson count "$count" --argjson bytes "$bytes" --argjson truncated "$truncated" \
    --arg pageHash "$page_hash" --arg previous "$CHECKPOINT_PREVIOUS_RECEIPT" \
    --arg fence "$FENCE_EVIDENCE_DIGEST" --arg config "$(jq -r '.configDigest' "$CHECKPOINT_DIR/config.json")" '
    {schemaVersion:1,side:$side,coordinate:$coordinate,identityFingerprint:$identity,
     sequence:$sequence,startAfter:(if $start=="" then null else $start end),
     firstKey:(if $first=="" then null else $first end),
     lastKey:(if $last=="" then null else $last end),objects:$count,bytes:$bytes,
     isTruncated:$truncated,pageManifestSha256:$pageHash,
     previousReceiptSha256:(if $previous=="" then null else $previous end),
     fenceEvidenceDigest:(if $fence=="null" then null else $fence end),
     configDigest:$config,observedAt:(now|todateiso8601)}' >"$tmp_receipt"
  sync -f "$tmp_page" "$tmp_receipt" && mv "$tmp_page" "$page" && mv "$tmp_receipt" "$receipt"
}
