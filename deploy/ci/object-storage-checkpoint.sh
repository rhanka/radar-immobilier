#!/usr/bin/env bash

checkpoint_phase() {
  if [ -n "${CHECKPOINT_PHASE_OVERRIDE:-}" ]; then printf '%s' "$CHECKPOINT_PHASE_OVERRIDE"; return; fi
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
  if ! sync -f "$tmp_page" "$tmp_receipt" || ! mv "$tmp_page" "$page" ||
    ! mv "$tmp_receipt" "$receipt"; then
    rm -f "$tmp_page" "$tmp_receipt" "$page" "$receipt"
    return 1
  fi
  CHECKPOINT_COMMITTED_PAGE="$page"
  CHECKPOINT_PREVIOUS_RECEIPT="$(sha256sum "$receipt" | awk '{print $1}')"
  [ -z "$last" ] || CHECKPOINT_LAST_KEY="$last"
  CHECKPOINT_SEQUENCE=$((CHECKPOINT_SEQUENCE + 1))
  [ "$truncated" = true ] || CHECKPOINT_TERMINAL=true
}

checkpoint_write_progress() {
  local side="$1" required="$2" complete="${3:-false}" target="$CHECKPOINT_DIR/progress.json" tmp
  tmp="$target.tmp"
  jq -n --arg side "$side" --arg phase "$(checkpoint_phase)" \
    --arg config "$(jq -r '.configDigest' "$CHECKPOINT_DIR/config.json")" \
    --arg fence "$FENCE_EVIDENCE_DIGEST" --arg last "$CHECKPOINT_LAST_KEY" \
    --argjson sequence "$CHECKPOINT_SEQUENCE" --argjson required "$required" \
    --argjson complete "$complete" '
    {schemaVersion:1,activeSide:$side,phase:$phase,configDigest:$config,
     fenceEvidenceDigest:(if $fence=="null" then null else $fence end),
     nextSequence:$sequence,lastKey:(if $last=="" then null else $last end),
     resumeRequired:$required,indexComplete:$complete,cutoverReady:false}' >"$tmp"
  sync -f "$tmp" && mv "$tmp" "$target"
}

list_objects_checkpoint() {
  local side="$1" output="$2" bucket token="" response next truncated elapsed validation_attempt
  local -a args
  bucket="$(bucket_for "$side")"; checkpoint_load_index "$side" "$output"
  if $CHECKPOINT_TERMINAL; then
    printf '%s\n' "$((CHECKPOINT_SEQUENCE - 1))" >"$REPORT_DIR/$side-pages.txt"
    return 0
  fi
  while :; do
    response="$WORK_DIR/$side-checkpoint-page-$CHECKPOINT_SEQUENCE.json"
    args=(list-objects-v2 --bucket "$bucket" --max-keys "$PAGE_SIZE")
    if [ -n "$token" ]; then
      args+=(--continuation-token "$token")
    elif [ -n "$CHECKPOINT_LAST_KEY" ]; then
      args+=(--start-after "$CHECKPOINT_LAST_KEY")
    fi
    validation_attempt=1
    while :; do
      retry_json "$response" "$side" "${args[@]}" || return 1
      truncated="$(jq -r '.IsTruncated // false' "$response")"
      case "$truncated" in true|false) ;; *) return 1 ;; esac
      checkpoint_commit_page "$side" "$response" "$truncated" && break
      validation_attempt=$((validation_attempt + 1))
      [ "$validation_attempt" -le "$RETRIES" ] || return 1
    done
    cat "$CHECKPOINT_COMMITTED_PAGE" >>"$output"
    if [ "$truncated" = false ]; then
      printf '%s\n' "$((CHECKPOINT_SEQUENCE - 1))" >"$REPORT_DIR/$side-pages.txt"
      return 0
    fi
    next="$(jq -r '.NextContinuationToken // empty' "$response")"
    [ -n "$next" ] || return 1; token="$next"
    elapsed=$(( $(date +%s) - CHECKPOINT_RUN_STARTED_EPOCH ))
    if [ "$elapsed" -ge "$TIME_BUDGET_SECONDS" ]; then
      CHECKPOINT_RESUME_REQUIRED=true
      checkpoint_write_progress "$side" true
      return 2
    fi
  done
}

checkpoint_validate_body_shard() {
  local side="$1" sequence="$2" phase dir base page body receipt page_hash body_hash
  local count bytes coordinate identity
  phase="$(checkpoint_phase)"; dir="$CHECKPOINT_DIR/$phase/$side"
  printf -v base '%06d' "$sequence"
  page="$dir/index-page-$base.jsonl"; body="$dir/body-manifest-$base.jsonl"
  receipt="$dir/body-receipt-$base.json"
  if [ -e "$body" ] && [ ! -e "$receipt" ]; then rm -f "$body"; fi
  if [ ! -e "$receipt" ]; then CHECKPOINT_BODY_PRESENT=false; return 0; fi
  [ -r "$body" ] || die "checkpoint body shard $sequence is missing"
  jq -es --slurpfile page "$page" '
    [.[].key] == [$page[].key] and ([.[].key] | length) == ([.[].key] | unique | length)
  ' "$body" >/dev/null || die "checkpoint body shard $sequence has a different key set"
  page_hash="$(sha256sum "$page" | awk '{print $1}')"
  body_hash="$(sha256sum "$body" | awk '{print $1}')"
  count="$(jq -s length "$body")"; bytes="$(jq -s 'map(.size) | add // 0' "$body")"
  coordinate="$(jq -c ".$side | del(.identityFingerprint)" "$CHECKPOINT_DIR/config.json")"
  identity="$(jq -r ".$side.identityFingerprint" "$CHECKPOINT_DIR/config.json")"
  jq -e --arg side "$side" --argjson sequence "$sequence" \
    --arg pageHash "$page_hash" --arg bodyHash "$body_hash" --argjson count "$count" \
    --argjson bytes "$bytes" --argjson coordinate "$coordinate" --arg identity "$identity" \
    --arg config "$(jq -r '.configDigest' "$CHECKPOINT_DIR/config.json")" \
    --arg fence "$FENCE_EVIDENCE_DIGEST" '
    .schemaVersion == 1 and .side == $side and .sequence == $sequence and
    .coordinate == $coordinate and .identityFingerprint == $identity and
    .configDigest == $config and .indexPageSha256 == $pageHash and
    .bodyManifestSha256 == $bodyHash and .objects == $count and .bytes == $bytes and
    .failures == 0 and
    .fenceEvidenceDigest == (if $fence=="null" then null else $fence end)' \
    "$receipt" >/dev/null || die "checkpoint body receipt $sequence is invalid"
  CHECKPOINT_BODY_PRESENT=true
}

checkpoint_validate_bodies() {
  local side="$1" sequence=1 missing=false phase dir page
  phase="$(checkpoint_phase)"; dir="$CHECKPOINT_DIR/$phase/$side"
  while :; do
    printf -v page '%s/index-page-%06d.jsonl' "$dir" "$sequence"
    [ -e "$page" ] || break
    checkpoint_validate_body_shard "$side" "$sequence"
    if $CHECKPOINT_BODY_PRESENT; then
      $missing && die 'checkpoint body shards are non-contiguous'
    else
      missing=true
    fi
    sequence=$((sequence + 1))
  done
}

checkpoint_commit_body() {
  local side="$1" sequence="$2" tmp_body="$3" phase dir base page body receipt tmp_receipt
  local page_hash body_hash count bytes coordinate identity
  phase="$(checkpoint_phase)"; dir="$CHECKPOINT_DIR/$phase/$side"
  printf -v base '%06d' "$sequence"; page="$dir/index-page-$base.jsonl"
  body="$dir/body-manifest-$base.jsonl"; receipt="$dir/body-receipt-$base.json"
  tmp_receipt="$receipt.tmp"; page_hash="$(sha256sum "$page" | awk '{print $1}')"
  body_hash="$(sha256sum "$tmp_body" | awk '{print $1}')"
  count="$(jq -s length "$tmp_body")"; bytes="$(jq -s 'map(.size) | add // 0' "$tmp_body")"
  coordinate="$(jq -c ".$side | del(.identityFingerprint)" "$CHECKPOINT_DIR/config.json")"
  identity="$(jq -r ".$side.identityFingerprint" "$CHECKPOINT_DIR/config.json")"
  jq -n --arg side "$side" --argjson sequence "$sequence" \
    --argjson coordinate "$coordinate" --arg identity "$identity" \
    --arg pageHash "$page_hash" --arg bodyHash "$body_hash" --argjson count "$count" \
    --argjson bytes "$bytes" --arg config "$(jq -r '.configDigest' "$CHECKPOINT_DIR/config.json")" \
    --arg fence "$FENCE_EVIDENCE_DIGEST" '
    {schemaVersion:1,side:$side,coordinate:$coordinate,identityFingerprint:$identity,
     sequence:$sequence,indexPageSha256:$pageHash,bodyManifestSha256:$bodyHash,
     objects:$count,bytes:$bytes,failures:0,configDigest:$config,
     fenceEvidenceDigest:(if $fence=="null" then null else $fence end),
     observedAt:(now|todateiso8601)}' >"$tmp_receipt"
  sync -f "$tmp_body" "$tmp_receipt" && mv "$tmp_body" "$body" && mv "$tmp_receipt" "$receipt"
}

build_manifest_checkpoint() {
  local side="$1" output="$2" phase dir sequence=1 page body tmp before after elapsed next body_status
  phase="$(checkpoint_phase)"; dir="$CHECKPOINT_DIR/$phase/$side"; : >"$output"
  while :; do
    printf -v page '%s/index-page-%06d.jsonl' "$dir" "$sequence"
    [ -e "$page" ] || break
    checkpoint_validate_body_shard "$side" "$sequence"
    printf -v body '%s/body-manifest-%06d.jsonl' "$dir" "$sequence"
    if ! $CHECKPOINT_BODY_PRESENT; then
      tmp="$body.tmp"; before="$(jq -s length "$REPORT_DIR/failures.jsonl")"
      CHECKPOINT_BUILDING_PAGE=true
      build_manifest "$side" "$page" "$tmp"; body_status=$?
      CHECKPOINT_BUILDING_PAGE=false
      after="$(jq -s length "$REPORT_DIR/failures.jsonl")"
      if [ "$body_status" -ne 0 ] || [ "$after" -ne "$before" ] ||
        ! jq -es --slurpfile page "$page" '[.[].key] == [$page[].key]' "$tmp" >/dev/null; then
        rm -f "$tmp"; return 1
      fi
      checkpoint_commit_body "$side" "$sequence" "$tmp" || return 1
    fi
    cat "$body" >>"$output"
    sequence=$((sequence + 1)); printf -v next '%s/index-page-%06d.jsonl' "$dir" "$sequence"
    if [ -e "$next" ]; then
      elapsed=$(( $(date +%s) - CHECKPOINT_RUN_STARTED_EPOCH ))
      if [ "$elapsed" -ge "$TIME_BUDGET_SECONDS" ]; then
        CHECKPOINT_SEQUENCE="$sequence" CHECKPOINT_RESUME_REQUIRED=true
        checkpoint_write_progress "$side" true
        return 2
      fi
    fi
  done
}

checkpoint_phase_summary() {
  local side="$1" phase="$2" output="$3" dir manifest tmp index_root body_root
  local manifest_hash count bytes
  dir="$CHECKPOINT_DIR/$phase/$side"
  manifest="$dir/manifest.jsonl"; tmp="$dir/manifest.jsonl.tmp"
  local -a pages=("$dir"/index-page-*.jsonl) indexes=("$dir"/index-receipt-*.json)
  local -a bodies=("$dir"/body-manifest-*.jsonl) body_receipts=("$dir"/body-receipt-*.json)
  [ -e "${pages[0]}" ] && [ "${#pages[@]}" -eq "${#indexes[@]}" ] &&
    [ "${#pages[@]}" -eq "${#bodies[@]}" ] &&
    [ "${#pages[@]}" -eq "${#body_receipts[@]}" ] || return 1
  if ! cat "${bodies[@]}" >"$tmp" || ! sync -f "$tmp" || ! mv "$tmp" "$manifest"; then
    rm -f "$tmp"
    return 1
  fi
  index_root="$(sha256sum "${indexes[${#indexes[@]}-1]}" | awk '{print $1}')"
  body_root="$(sha256sum "${body_receipts[@]}" | awk '{print $1}' | sha256sum | awk '{print $1}')"
  manifest_hash="$(sha256sum "$manifest" | awk '{print $1}')"
  count="$(jq -s length "$manifest")"; bytes="$(jq -s 'map(.size) | add // 0' "$manifest")"
  jq -n --arg index "$index_root" --arg body "$body_root" --arg manifest "$manifest_hash" \
    --argjson pages "${#pages[@]}" --argjson count "$count" --argjson bytes "$bytes" '
    {indexReceiptRootSha256:$index,bodyReceiptRootSha256:$body,
     manifestSha256:$manifest,pages:$pages,objects:$count,bytes:$bytes}' >"$output"
}

checkpoint_validate_phase() {
  local phase="$1" fence="$2" saved_phase="${CHECKPOINT_PHASE_OVERRIDE:-}"
  local saved_fence="$FENCE_EVIDENCE_DIGEST"
  CHECKPOINT_PHASE_OVERRIDE="$phase" FENCE_EVIDENCE_DIGEST="$fence"
  checkpoint_load_index source "$WORK_DIR/$phase-source-index.jsonl"
  $CHECKPOINT_TERMINAL || die "$phase source index has no terminal receipt"
  checkpoint_validate_bodies source
  checkpoint_load_index destination "$WORK_DIR/$phase-destination-index.jsonl"
  checkpoint_validate_bodies destination
  $CHECKPOINT_TERMINAL || die "$phase destination index has no terminal receipt"
  checkpoint_phase_summary source "$phase" "$WORK_DIR/$phase-source-validation.json" &&
    checkpoint_phase_summary destination "$phase" "$WORK_DIR/$phase-destination-validation.json" ||
    die "$phase body evidence is incomplete"
  CHECKPOINT_PHASE_OVERRIDE="$saved_phase" FENCE_EVIDENCE_DIGEST="$saved_fence"
}

checkpoint_finalize() {
  local fence="$FENCE_EVIDENCE_DIGEST" target="$CHECKPOINT_DIR/final-inventory.json" tmp
  local ps="$WORK_DIR/provisional-source-summary.json"
  local pd="$WORK_DIR/provisional-destination-summary.json"
  local fs="$WORK_DIR/fenced-source-summary.json" fd="$WORK_DIR/fenced-destination-summary.json"
  [ "$fence" != null ] || return 1
  checkpoint_validate_phase provisional null
  checkpoint_validate_phase fenced "$fence"
  checkpoint_phase_summary source provisional "$ps" &&
    checkpoint_phase_summary destination provisional "$pd" &&
    checkpoint_phase_summary source fenced "$fs" &&
    checkpoint_phase_summary destination fenced "$fd" || return 1
  files_equal "$CHECKPOINT_DIR/provisional/source/manifest.jsonl" \
    "$CHECKPOINT_DIR/fenced/source/manifest.jsonl" || return 1
  files_equal "$CHECKPOINT_DIR/provisional/destination/manifest.jsonl" \
    "$CHECKPOINT_DIR/fenced/destination/manifest.jsonl" || return 1
  jq -se 'all(.[]; .classification != "unclassified")' \
    "$CHECKPOINT_DIR/fenced/source/manifest.jsonl" >/dev/null || return 1
  tmp="$target.tmp"
  jq -n --arg config "$(jq -r '.configDigest' "$CHECKPOINT_DIR/config.json")" \
    --arg fence "$fence" --slurpfile ps "$ps" --slurpfile pd "$pd" \
    --slurpfile fs "$fs" --slurpfile fd "$fd" '
    {schemaVersion:1,configDigest:$config,fenceEvidenceDigest:$fence,
     toolComplete:true,fenceValidated:false,providerEnforcementValidated:false,
     source:{provisional:$ps[0],fenced:$fs[0]},
     destination:{provisional:$pd[0],fenced:$fd[0]}}' >"$tmp"
  sync -f "$tmp" && mv "$tmp" "$target"
  CHECKPOINT_FINAL_DIGEST="$(sha256sum "$target" | awk '{print $1}')"
}

consume_inventory_proof() {
  local proof="$1" root config expected_config_digest actual_config_digest
  local provisional_source provisional_destination fenced_source fenced_destination
  local prefixes exclusions
  [ -r "$proof" ] && [ -s "$proof" ] || return 1
  root="$(cd "$(dirname "$proof")" && pwd)"; config="$root/config.json"
  provisional_source="$root/provisional/source/manifest.jsonl"
  provisional_destination="$root/provisional/destination/manifest.jsonl"
  fenced_source="$root/fenced/source/manifest.jsonl"
  fenced_destination="$root/fenced/destination/manifest.jsonl"
  for file in "$config" "$provisional_source" "$provisional_destination" \
    "$fenced_source" "$fenced_destination"; do [ -r "$file" ] || return 1; done
  expected_config_digest="$(jq -r '.configDigest // empty' "$config")"
  actual_config_digest="$(jq 'del(.configDigest)' "$config" | sha256sum | awk '{print $1}')"
  [ "$expected_config_digest" = "$actual_config_digest" ] || return 1
  prefixes="$(jq -cn --args '$ARGS.positional | sort' -- "${PREFIXES[@]}")"
  exclusions="$(jq -cn --args '$ARGS.positional | sort' -- "${EXCLUDE_PREFIXES[@]}")"
  jq -e --arg se "$SOURCE_ENDPOINT" --arg sr "$SOURCE_REGION" --arg sb "$SOURCE_BUCKET" \
    --arg environment "$ENVIRONMENT" --arg plane "$PLANE" \
    --argjson sp "$SOURCE_PATH_STYLE" --arg sf "$SOURCE_IDENTITY_FINGERPRINT" \
    --arg de "$DESTINATION_ENDPOINT" --arg dr "$DESTINATION_REGION" \
    --arg db "$DESTINATION_BUCKET" --argjson dp "$DESTINATION_PATH_STYLE" \
    --arg df "$DESTINATION_IDENTITY_FINGERPRINT" --argjson prefixes "$prefixes" \
    --argjson exclusions "$exclusions" --argjson retries "$RETRIES" \
    --argjson concurrency "$CONCURRENCY" --argjson failures "$MAX_FAILURES" \
    --argjson bytes "$MAX_OBJECT_BYTES" '
    .schemaVersion == 1 and .environment == $environment and .plane == $plane and
    .source == {endpoint:$se,region:$sr,bucket:$sb,pathStyle:$sp,identityFingerprint:$sf} and
    .destination == {endpoint:$de,region:$dr,bucket:$db,pathStyle:$dp,identityFingerprint:$df} and
    .classification == {prefixes:$prefixes,excludePrefixes:$exclusions} and
    .limits.retries == $retries and .limits.concurrency == $concurrency and
    .limits.maxFailures == $failures and .limits.maxObjectBytes == $bytes' "$config" >/dev/null ||
    return 1
  if ! (CHECKPOINT_DIR="$root"
    checkpoint_validate_phase provisional null
    checkpoint_validate_phase fenced "$FENCE_EVIDENCE_DIGEST"
    checkpoint_phase_summary source provisional "$WORK_DIR/proof-ps.json"
    checkpoint_phase_summary destination provisional "$WORK_DIR/proof-pd.json"
    checkpoint_phase_summary source fenced "$WORK_DIR/proof-fs.json"
    checkpoint_phase_summary destination fenced "$WORK_DIR/proof-fd.json"); then return 1; fi
  files_equal "$provisional_source" "$fenced_source" &&
    files_equal "$provisional_destination" "$fenced_destination" || return 1
  jq -e --arg config "$expected_config_digest" --arg fence "$FENCE_EVIDENCE_DIGEST" \
    --arg ps "$(sha256sum "$provisional_source" | awk '{print $1}')" \
    --arg pd "$(sha256sum "$provisional_destination" | awk '{print $1}')" \
    --arg fs "$(sha256sum "$fenced_source" | awk '{print $1}')" \
    --arg fd "$(sha256sum "$fenced_destination" | awk '{print $1}')" \
    --slurpfile psr "$WORK_DIR/proof-ps.json" --slurpfile pdr "$WORK_DIR/proof-pd.json" \
    --slurpfile fsr "$WORK_DIR/proof-fs.json" --slurpfile fdr "$WORK_DIR/proof-fd.json" '
    .schemaVersion == 1 and .configDigest == $config and .fenceEvidenceDigest == $fence and
    .toolComplete == true and .fenceValidated == false and
    .providerEnforcementValidated == false and
    .source.provisional.manifestSha256 == $ps and .source.fenced.manifestSha256 == $fs and
    .destination.provisional.manifestSha256 == $pd and
    .destination.fenced.manifestSha256 == $fd and
    .source == {provisional:$psr[0],fenced:$fsr[0]} and
    .destination == {provisional:$pdr[0],fenced:$fdr[0]}' "$proof" >/dev/null || return 1
  jq -se 'all(.[]; .classification != "unclassified")' "$fenced_source" >/dev/null || return 1
  cp "$fenced_source" "$SOURCE_MANIFEST"
  cp "$fenced_destination" "$DESTINATION_MANIFEST"
  INVENTORY_PROOF_DIGEST="$(sha256sum "$proof" | awk '{print $1}')"
}
