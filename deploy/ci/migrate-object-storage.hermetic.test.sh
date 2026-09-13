#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="$HERE/migrate-object-storage.sh"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/migration-hermetic.XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT
mkdir -p "$TEST_TMP/bin" "$TEST_TMP/store/source/src/objects" \
  "$TEST_TMP/store/source/src/meta" "$TEST_TMP/store/destination/dst/objects" \
  "$TEST_TMP/store/destination/dst/meta"
AWS_LOG="$TEST_TMP/aws.log"; : >"$AWS_LOG"

cat >"$TEST_TMP/bin/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
side=destination
[ "${AWS_ACCESS_KEY_ID:-}" = SRC_KEY ] && side=source
root="$FAKE_S3_ROOT/$side"; log="$FAKE_AWS_LOG"
while [ "$#" -gt 0 ] && [ "$1" != s3api ]; do shift; done
[ "${1:-}" = s3api ] || exit 90
shift; op="$1"; shift
printf '%s\t%s\t%s\n' "$side" "$op" "$*" >>"$log"
trap 'status=$?; [ "$status" -eq 0 ] || printf "shim-error\t%s\t%s\t%s\n" "$op" "$status" "$LINENO" >>"$log"' EXIT
arg() {
  local wanted="$1" previous="" value
  shift
  for value in "$@"; do
    [ "$previous" = "$wanted" ] && { printf '%s' "$value"; return; }
    previous="$value"
  done
  return 0
}
bucket="$(arg --bucket "$@")"; key="$(arg --key "$@")"
if [ "${FAKE_FAIL_SIDE:-}" = "$side" ] && [ "${FAKE_FAIL_OPERATION:-}" = "$op" ] &&
  { [ -z "${FAKE_FAIL_KEY:-}" ] || [ "$FAKE_FAIL_KEY" = "$key" ]; }; then
  counter="$FAKE_S3_TMP/failure-counter"; seen="$(cat "$counter" 2>/dev/null || printf 0)"
  if [ "$seen" -lt "${FAKE_FAIL_ATTEMPTS:-0}" ]; then
    printf '%s' "$((seen + 1))" >"$counter"; exit 71
  fi
fi
objects="$root/$bucket/objects"; meta="$root/$bucket/meta"
object="$objects/$key"; metadata="$meta/$key.json"
case "$op" in
  head-bucket)
    [ -d "$objects" ] || exit 44
    printf '{}\n'
    ;;
  list-objects-v2)
    start="$(arg --continuation-token "$@")"; start="${start:-0}"
    start_after="$(arg --start-after "$@")"; requested="$(arg --max-keys "$@")"
    page_size="${FAKE_PAGE_SIZE:-${requested:-1000}}"; all="$FAKE_S3_TMP/all.jsonl"; : >"$all"
    if [ -d "$objects" ]; then
      while IFS= read -r file; do
        rel="${file#"$objects/"}"; size="$(wc -c <"$file")"
        etag="$(jq -r '.ETag // "etag"' "$meta/$rel.json")"
        jq -cn --arg key "$rel" --argjson size "$size" --arg etag "$etag" \
          '{Key:$key,Size:$size,ETag:$etag}' >>"$all"
      done < <(find "$objects" -type f | sort)
    fi
    if [ "${FAKE_EMPTY_TRUNCATED_SIDE:-}" = "$side" ]; then
      empty_counter="$FAKE_S3_TMP/empty-truncated-counter"
      empty_seen="$(cat "$empty_counter" 2>/dev/null || printf 0)"
      if [ "$empty_seen" -lt "${FAKE_EMPTY_TRUNCATED_ATTEMPTS:-0}" ]; then
        printf '%s' "$((empty_seen + 1))" >"$empty_counter"
        printf '{"Contents":[],"IsTruncated":true,"NextContinuationToken":"empty"}\n'; exit 0
      fi
    fi
    if [ -n "$start_after" ]; then
      start="$(jq -s --arg key "$start_after" \
        '[to_entries[] | select(.value.Key > $key) | .key][0] // length' "$all")"
    fi
    jq -s --argjson start "$start" --argjson size "$page_size" '
      length as $total | (.[$start:($start+$size)]) as $page |
      {Contents:$page,IsTruncated:($start+$size < $total),
       NextContinuationToken:(if $start+$size < $total then (($start+$size)|tostring) else null end)}' "$all"
    ;;
  head-object)
    [ -f "$object" ] || exit 45
    size="$(wc -c <"$object")"
    jq --argjson size "$size" \
      '{ContentLength:$size,ContentType:(.ContentType // null),
       ContentEncoding:(.ContentEncoding // null),CacheControl:(.CacheControl // null),
       ContentDisposition:(.ContentDisposition // null),Metadata:(.Metadata // {}),
       ETag:(.ETag // "etag"),VersionId:(.VersionId // null)}' "$metadata"
    ;;
  get-object)
    [ -f "$object" ] || exit 45
    output="${!#}"; mkdir -p "$(dirname "$output")"; cp "$object" "$output"
    jq '{VersionId:(.VersionId // null)}' "$metadata"
    ;;
  get-object-tagging)
    [ -f "$object" ] || exit 45
    jq '{TagSet:(.TagSet // [])}' "$metadata"
    ;;
  get-bucket-versioning)
    jq -cn --arg status "${FAKE_VERSIONING:-Enabled}" '{Status:$status}'
    ;;
  put-object)
    body="$(arg --body "$@")"; none="$(arg --if-none-match "$@")"
    match="$(arg --if-match "$@")"
    [ -z "$none" ] || [ ! -f "$object" ] || exit 46
    if [ -n "$match" ]; then
      [ -f "$object" ] && [ "$(jq -r '.ETag' "$metadata")" = "$match" ] || exit 47
    fi
    mkdir -p "$(dirname "$object")" "$(dirname "$metadata")"
    cp "$body" "$object"
    counter="$FAKE_S3_TMP/version"; version=$(( $(cat "$counter" 2>/dev/null || printf 0) + 1 ))
    printf '%s' "$version" >"$counter"; version_id="v$version"
    [ "${FAKE_VERSIONING:-Enabled}" = Enabled ] || version_id=""
    content_type="$(arg --content-type "$@")"; encoding="$(arg --content-encoding "$@")"
    cache="$(arg --cache-control "$@")"; disposition="$(arg --content-disposition "$@")"
    user_meta="$(arg --metadata "$@")"; [ -n "$user_meta" ] || user_meta='{}'
    tagging="$(arg --tagging "$@")"
    tags='[]'
    [ -z "$tagging" ] || tags="$(printf '%s' "$tagging" | jq -R '
      split("&") | map(split("=") | {Key:.[0],Value:.[1]})')"
    etag="\"$(sha256sum "$body" | awk '{print substr($1,1,16)}')\""
    jq -n --arg ct "$content_type" --arg ce "$encoding" --arg cc "$cache" --arg cd "$disposition" \
      --argjson metadata "$user_meta" --argjson tags "$tags" --arg etag "$etag" \
      --arg version "$version_id" \
      '{ContentType:(if $ct=="" then null else $ct end),
       ContentEncoding:(if $ce=="" then null else $ce end),
       CacheControl:(if $cc=="" then null else $cc end),
       ContentDisposition:(if $cd=="" then null else $cd end),Metadata:$metadata,
       TagSet:$tags,ETag:$etag,VersionId:(if $version=="" then null else $version end)}' >"$metadata"
    jq -n --arg version "$version_id" \
      '{VersionId:(if $version=="" then null else $version end)}'
    ;;
  *) exit 89 ;;
esac
AWS
chmod +x "$TEST_TMP/bin/aws"

cat >"$TEST_TMP/bin/date" <<'DATE'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = +%s ] && [ -n "${FAKE_CLOCK_STEP:-}" ]; then
  current="$(cat "$FAKE_CLOCK_FILE" 2>/dev/null || printf 1000)"
  printf '%s\n' "$current"; printf '%s' "$((current + FAKE_CLOCK_STEP))" >"$FAKE_CLOCK_FILE"
else
  exec /usr/bin/date "$@"
fi
DATE
chmod +x "$TEST_TMP/bin/date"

PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
expect_ok() {
  local log="$TEST_TMP/last-command.log"
  if "$@" >"$log" 2>&1; then ok "$TEST_NAME"; else bad "$TEST_NAME"; cat "$log" >&2; fi
}
expect_bad() { "$@" >/dev/null 2>&1 && bad "$TEST_NAME" || ok "$TEST_NAME"; }
expect_status() {
  local expected="$1" actual log="$TEST_TMP/last-command.log"
  shift
  "$@" >"$log" 2>&1; actual=$?
  if [ "$actual" -eq "$expected" ]; then ok "$TEST_NAME"; else bad "$TEST_NAME"; cat "$log" >&2; fi
}

reset_store() {
  local fingerprint
  rm -rf "$TEST_TMP/store" "$TEST_TMP/reports"
  mkdir -p "$TEST_TMP/store/source/src/objects" "$TEST_TMP/store/source/src/meta" \
    "$TEST_TMP/store/destination/dst/objects" "$TEST_TMP/store/destination/dst/meta" \
    "$TEST_TMP/reports"
  : >"$AWS_LOG"; rm -f "$TEST_TMP/version" "$TEST_TMP/failure-counter" "$TEST_TMP/clock"
  rm -f "$TEST_TMP/empty-truncated-counter"
  fingerprint="$(printf DST_KEY | sha256sum | awk '{print $1}')"
  jq -n --arg fingerprint "$fingerprint" '{schemaVersion:1,provider:"fake-s3",providerVersion:"1",
    destination:{endpoint:"https://destination.test",region:"bhs",bucket:"dst",pathStyle:false},
    identityFingerprint:$fingerprint,
    observedAt:((now - 3600) | todateiso8601),expiresAt:((now + 82800) | todateiso8601),
    transcriptSha256:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    capabilities:{ifNoneMatchCreate:true,ifMatchUpdate:true}}' >"$TEST_TMP/conditional-write-proof.json"
  unset FAKE_FAIL_SIDE FAKE_FAIL_OPERATION FAKE_FAIL_ATTEMPTS FAKE_FAIL_KEY
  unset FAKE_VERSIONING FAKE_CLOCK_STEP FAKE_EMPTY_TRUNCATED_SIDE
  unset FAKE_EMPTY_TRUNCATED_ATTEMPTS
}
put_fixture() {
  local side="$1" bucket="$2" key="$3" content="$4" extra="${5:-}"
  local base="$TEST_TMP/store/$side/$bucket" file
  [ -n "$extra" ] || extra='{}'
  file="$base/objects/$key"
  mkdir -p "$(dirname "$file")" "$(dirname "$base/meta/$key.json")"
  printf '%s' "$content" >"$file"
  jq -n --argjson extra "$extra" '
    {ContentType:"application/octet-stream",ContentEncoding:null,CacheControl:null,
     ContentDisposition:null,Metadata:{},TagSet:[],ETag:"fixture-etag",VersionId:"fixture-v1"}
     * $extra' >"$base/meta/$key.json"
}
BASE_ARGS=(--environment preprod --plane RAW
  --source-endpoint http://source.test --source-region local --source-bucket src
  --source-path-style true --destination-endpoint https://destination.test
  --destination-region bhs --destination-bucket dst --destination-path-style false
  --prefix raw/)
invoke_tool() {
  env PATH="$TEST_TMP/bin:$PATH" FAKE_S3_ROOT="$TEST_TMP/store" \
    FAKE_S3_TMP="$TEST_TMP" FAKE_AWS_LOG="$AWS_LOG" \
    FAKE_PAGE_SIZE="${FAKE_PAGE_SIZE:-}" FAKE_VERSIONING="${FAKE_VERSIONING:-Enabled}" \
    FAKE_CLOCK_STEP="${FAKE_CLOCK_STEP:-}" FAKE_CLOCK_FILE="$TEST_TMP/clock" \
    FAKE_FAIL_SIDE="${FAKE_FAIL_SIDE:-}" FAKE_FAIL_OPERATION="${FAKE_FAIL_OPERATION:-}" \
    FAKE_FAIL_ATTEMPTS="${FAKE_FAIL_ATTEMPTS:-0}" FAKE_FAIL_KEY="${FAKE_FAIL_KEY:-}" \
    FAKE_EMPTY_TRUNCATED_SIDE="${FAKE_EMPTY_TRUNCATED_SIDE:-}" \
    FAKE_EMPTY_TRUNCATED_ATTEMPTS="${FAKE_EMPTY_TRUNCATED_ATTEMPTS:-0}" \
    MIGRATION_RUN_ID=test-run MIGRATION_SOURCE_ACCESS_KEY_ID=SRC_KEY \
    MIGRATION_SOURCE_SECRET_ACCESS_KEY=SRC_SECRET \
    MIGRATION_DESTINATION_ACCESS_KEY_ID=DST_KEY \
    MIGRATION_DESTINATION_SECRET_ACCESS_KEY=DST_SECRET \
    "$TOOL" "$@"
}
PROOF_SERIAL=0
make_inventory_proof() {
  local requested_fence="$1" plane="$2" checkpoint report1 report2
  PROOF_SERIAL=$((PROOF_SERIAL + 1)); checkpoint="$TEST_TMP/generated-proof-$PROOF_SERIAL"
  report1="$TEST_TMP/proof-reports-$PROOF_SERIAL-a"; report2="$TEST_TMP/proof-reports-$PROOF_SERIAL-b"
  GENERATED_FENCE="$TEST_TMP/generated-fence-$PROOF_SERIAL.txt"
  printf 'hermetic writers fenced\n' >"$GENERATED_FENCE"
  [ -z "$requested_fence" ] || [ ! -s "$requested_fence" ] || GENERATED_FENCE="$requested_fence"
  invoke_tool inventory "${BASE_ARGS[@]}" --plane "$plane" --report-dir "$report1" \
    --checkpoint-dir "$checkpoint" --page-size 100 --time-budget-seconds 30 >/dev/null 2>&1 || true
  invoke_tool inventory "${BASE_ARGS[@]}" --plane "$plane" --report-dir "$report2" \
    --checkpoint-dir "$checkpoint" --page-size 100 --time-budget-seconds 30 \
    --fence-record "$GENERATED_FENCE" --resume >/dev/null 2>&1 || true
  GENERATED_INVENTORY_PROOF="$checkpoint/final-inventory.json"
}
run_tool() {
  local operation="$1" report="$2" status execute=false explicit_fence="" plane=RAW index; shift 2
  local -a conditional_args=() inventory_args=() fence_args=() passed=("$@")
  [ "${OMIT_CONDITIONAL_WRITE_PROOF:-false}" = true ] || \
    conditional_args=(--conditional-write-proof "$TEST_TMP/conditional-write-proof.json")
  for ((index=0; index<${#passed[@]}; index++)); do
    [ "${passed[index]}" != --execute-copy ] || execute=true
    [ "${passed[index]}" != --fence-record ] || explicit_fence="${passed[index+1]}"
    [ "${passed[index]}" != --plane ] || plane="${passed[index+1]}"
  done
  if $execute && [ "${OMIT_INVENTORY_PROOF:-false}" != true ]; then
    make_inventory_proof "$explicit_fence" "$plane"
    inventory_args=(--inventory-proof "$GENERATED_INVENTORY_PROOF")
    [ -n "$explicit_fence" ] || fence_args=(--fence-record "$GENERATED_FENCE")
    : >"$AWS_LOG"
  fi
  invoke_tool "$operation" "${BASE_ARGS[@]}" --report-dir "$report" \
    "${conditional_args[@]}" "${inventory_args[@]}" "${fence_args[@]}" "$@"
  status=$?
  [ "$status" -eq 0 ] || {
    [ ! -f "$report/summary.json" ] || jq . "$report/summary.json" >&2
    cat "$AWS_LOG" >&2
  }
  return "$status"
}
run_tool_without_capability() { OMIT_CONDITIONAL_WRITE_PROOF=true run_tool "$@"; }
run_tool_without_inventory() { OMIT_INVENTORY_PROOF=true run_tool "$@"; }

make_expected_union() {
  local evidence="$1" output="$2" proof
  proof="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  jq -n --slurpfile source "$evidence/source-included-manifest.jsonl" \
    --slurpfile destination "$evidence/destination-manifest.jsonl" --arg proof "$proof" '
    def core: del(.etag,.versionId,.classification,.sources);
    {schemaVersion:1,
     sources:[
       {endpoint:"http://source.test",region:"local",bucket:"src",pathStyle:true,
        observedAt:"2026-09-13T12:00:00Z",manifestSha256:$proof,fenceSha256:$proof},
       {endpoint:"https://other.test",region:"bhs",bucket:"other",pathStyle:false,
        observedAt:"2026-09-13T12:00:00Z",manifestSha256:$proof,fenceSha256:$proof}],
     objects:[
       ($source[] | core + {sources:[{endpoint:"http://source.test",region:"local",
         bucket:"src",pathStyle:true}]}),
       ($destination[] | select(.key == "raw/from-other.txt") | core +
         {sources:[{endpoint:"https://other.test",region:"bhs",bucket:"other",pathStyle:false}]})]}' \
    >"$output"
}

reset_store; put_fixture source src raw/a.txt alpha
TEST_NAME='copy defaults to a read-only dry run'
expect_ok run_tool copy "$TEST_TMP/reports/dry"
TEST_NAME='dry run reports missing without writing'
if [ ! -e "$TEST_TMP/store/destination/dst/objects/raw/a.txt" ] &&
  jq -e '.counts.missing == 1 and .executeCopy == false' "$TEST_TMP/reports/dry/summary.json" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

reset_store
TEST_NAME='rejects an empty root prefix'
expect_bad run_tool inventory "$TEST_TMP/reports/root" --prefix ''
TEST_NAME='rejects traversal prefixes'
expect_bad run_tool inventory "$TEST_TMP/reports/traversal" --prefix 'raw/../docs/'
TEST_NAME='rejects duplicate or overlapping prefixes'
expect_bad run_tool inventory "$TEST_TMP/reports/overlap" --prefix 'raw/a/'
TEST_NAME='rejects identical normalized source and destination tuples'
expect_bad run_tool inventory "$TEST_TMP/reports/tuple" \
  --destination-endpoint http://source.test --destination-region local \
  --destination-bucket src --destination-path-style true
TEST_NAME='requires an approved union for every DOCS proof or copy operation'
expect_bad run_tool verify "$TEST_TMP/reports/docs-no-union" --plane DOCS
TEST_NAME='requires a complete destination credential family'
expect_bad env PATH="$TEST_TMP/bin:$PATH" FAKE_S3_ROOT="$TEST_TMP/store" \
  FAKE_S3_TMP="$TEST_TMP" FAKE_AWS_LOG="$AWS_LOG" \
  MIGRATION_SOURCE_ACCESS_KEY_ID=SRC_KEY MIGRATION_SOURCE_SECRET_ACCESS_KEY=SRC_SECRET \
  MIGRATION_DESTINATION_ACCESS_KEY_ID=DST_KEY MIGRATION_DESTINATION_SECRET_ACCESS_KEY= \
  "$TOOL" inventory "${BASE_ARGS[@]}" --report-dir "$TEST_TMP/reports/missing-credential"

reset_store
TEST_NAME='checkpoint controls are limited to inventory'
expect_bad run_tool verify "$TEST_TMP/reports/checkpoint-verify" \
  --checkpoint-dir "$TEST_TMP/checkpoint-verify"
TEST_NAME='resume requires an initialized checkpoint'
expect_bad run_tool inventory "$TEST_TMP/reports/uninitialized-resume" \
  --checkpoint-dir "$TEST_TMP/uninitialized-checkpoint" --resume
TEST_NAME='inventory persists a credential-free canonical checkpoint configuration'
expect_ok run_tool inventory "$TEST_TMP/reports/checkpoint-initial" \
  --checkpoint-dir "$TEST_TMP/checkpoint" --page-size 1 --time-budget-seconds 30
if jq -e '.schemaVersion == 1 and (.configDigest | test("^[0-9a-f]{64}$")) and
    .limits.pageSize == 1 and .classification.prefixes == ["raw/"]' \
    "$TEST_TMP/checkpoint/config.json" >/dev/null &&
  ! grep -R -E 'SRC_SECRET|DST_SECRET' "$TEST_TMP/checkpoint" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi
: >"$AWS_LOG"
TEST_NAME='resume rejects a changed checkpoint configuration before storage access'
expect_bad run_tool inventory "$TEST_TMP/reports/checkpoint-mismatch" \
  --checkpoint-dir "$TEST_TMP/checkpoint" --page-size 2 --time-budget-seconds 30 --resume
if [ ! -s "$AWS_LOG" ]; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/a.txt alpha; put_fixture source src raw/b.txt beta
put_fixture destination dst raw/a.txt alpha; put_fixture destination dst raw/b.txt beta
FAKE_CLOCK_STEP=2
TEST_NAME='bounded inventory exits one with a durable resume receipt'
expect_status 1 run_tool inventory "$TEST_TMP/reports/resume-first" \
  --checkpoint-dir "$TEST_TMP/resume-checkpoint" --page-size 1 --time-budget-seconds 1
if jq -e '.resumeRequired == true and .cutoverReady == false' \
    "$TEST_TMP/reports/resume-first/summary.json" >/dev/null &&
  jq -e '.sequence == 1 and .startAfter == null and .isTruncated == true' \
    "$TEST_TMP/resume-checkpoint/provisional/source/index-receipt-000001.json" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi
printf '{"key":"uncommitted-tail","size":0,"etag":""}\n' \
  >"$TEST_TMP/resume-checkpoint/provisional/source/index-page-000002.jsonl"
unset FAKE_CLOCK_STEP; : >"$AWS_LOG"
TEST_NAME='resume continues exclusively after the last committed key'
expect_ok run_tool inventory "$TEST_TMP/reports/resume-second" \
  --checkpoint-dir "$TEST_TMP/resume-checkpoint" --page-size 1 --time-budget-seconds 30 --resume
if grep -Eq $'^source\tlist-objects-v2\t.*--start-after raw/a.txt' "$AWS_LOG" &&
  jq -e '.sequence == 2 and .startAfter == "raw/a.txt" and .isTruncated == false' \
    "$TEST_TMP/resume-checkpoint/provisional/source/index-receipt-000002.json" >/dev/null &&
  jq -e -s '.[0].key == "raw/b.txt" and length == 1' \
    "$TEST_TMP/resume-checkpoint/provisional/source/index-page-000002.jsonl" >/dev/null &&
  jq -e '.resumeRequired == false and .indexComplete == true and .cutoverReady == false' \
    "$TEST_TMP/resume-checkpoint/progress.json" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/a.txt alpha; put_fixture source src raw/b.txt beta
put_fixture destination dst raw/a.txt alpha; put_fixture destination dst raw/b.txt beta
FAKE_FAIL_SIDE=source FAKE_FAIL_OPERATION=get-object FAKE_FAIL_KEY=raw/b.txt FAKE_FAIL_ATTEMPTS=99
TEST_NAME='failed body shard preserves each earlier committed shard'
expect_status 1 run_tool inventory "$TEST_TMP/reports/body-first" \
  --checkpoint-dir "$TEST_TMP/body-checkpoint" --page-size 1 --time-budget-seconds 30 --retries 1
if [ -s "$TEST_TMP/body-checkpoint/provisional/source/body-receipt-000001.json" ] &&
  [ ! -e "$TEST_TMP/body-checkpoint/provisional/source/body-receipt-000002.json" ]; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi
unset FAKE_FAIL_SIDE FAKE_FAIL_OPERATION FAKE_FAIL_KEY FAKE_FAIL_ATTEMPTS
rm -f "$TEST_TMP/failure-counter"; : >"$AWS_LOG"
TEST_NAME='body resume reads only the previously failed shard'
expect_ok run_tool inventory "$TEST_TMP/reports/body-second" \
  --checkpoint-dir "$TEST_TMP/body-checkpoint" --page-size 1 --time-budget-seconds 30 \
  --retries 1 --resume
if ! grep -Eq $'^source\tget-object\t.*--key raw/a.txt' "$AWS_LOG" &&
  grep -Eq $'^source\tget-object\t.*--key raw/b.txt' "$AWS_LOG" &&
  [ -s "$TEST_TMP/body-checkpoint/provisional/source/body-receipt-000002.json" ]; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi
printf '{"key":"tampered","size":0}\n' \
  >"$TEST_TMP/body-checkpoint/provisional/source/body-manifest-000001.jsonl"
: >"$AWS_LOG"
TEST_NAME='tampered body checkpoint fails before storage access'
expect_bad run_tool inventory "$TEST_TMP/reports/body-tampered" \
  --checkpoint-dir "$TEST_TMP/body-checkpoint" --page-size 1 --time-budget-seconds 30 \
  --retries 1 --resume
if [ ! -s "$AWS_LOG" ]; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
TEST_NAME='empty buckets commit anchored terminal index and body receipts'
expect_ok run_tool inventory "$TEST_TMP/reports/empty-checkpoint" \
  --checkpoint-dir "$TEST_TMP/empty-checkpoint" --page-size 1 --time-budget-seconds 30
if jq -e '.firstKey == null and .lastKey == null and .isTruncated == false' \
    "$TEST_TMP/empty-checkpoint/provisional/source/index-receipt-000001.json" >/dev/null &&
  jq -e '.objects == 0 and .failures == 0' \
    "$TEST_TMP/empty-checkpoint/provisional/source/body-receipt-000001.json" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/a.txt alpha; put_fixture destination dst raw/a.txt alpha
FAKE_EMPTY_TRUNCATED_SIDE=source FAKE_EMPTY_TRUNCATED_ATTEMPTS=1
TEST_NAME='empty truncated page is retried without advancing its receipt'
expect_ok run_tool inventory "$TEST_TMP/reports/empty-truncated" \
  --checkpoint-dir "$TEST_TMP/empty-truncated" --page-size 1 --time-budget-seconds 30
if [ "$(grep -c $'^source\tlist-objects-v2\t' "$AWS_LOG")" = 2 ] &&
  jq -e '.sequence == 1 and .objects == 1 and .firstKey == "raw/a.txt"' \
    "$TEST_TMP/empty-truncated/provisional/source/index-receipt-000001.json" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/oversized.txt alpha
TEST_NAME='oversized checkpoint object remains an explicit completeness blocker'
expect_status 1 run_tool inventory "$TEST_TMP/reports/oversized" \
  --checkpoint-dir "$TEST_TMP/oversized" --page-size 1 --time-budget-seconds 30 \
  --max-object-bytes 4
if [ ! -e "$TEST_TMP/oversized/provisional/source/body-receipt-000001.json" ] &&
  jq -e '.inventoryCheckpoint.toolComplete == false and .counts.failures == 1' \
    "$TEST_TMP/reports/oversized/summary.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/stable.txt alpha '{"VersionId":null}'
put_fixture destination dst raw/stable.txt alpha '{"VersionId":null}'
run_tool inventory "$TEST_TMP/reports/final-provisional" \
  --checkpoint-dir "$TEST_TMP/final-checkpoint" --page-size 1 --time-budget-seconds 30 >/dev/null
printf 'writers fenced\n' >"$TEST_TMP/final-fence.txt"; : >"$AWS_LOG"
TEST_NAME='fenced inventory finalizes distinct stable whole-bucket chains'
expect_ok run_tool inventory "$TEST_TMP/reports/final-fenced" \
  --checkpoint-dir "$TEST_TMP/final-checkpoint" --page-size 1 --time-budget-seconds 30 \
  --fence-record "$TEST_TMP/final-fence.txt" --resume
if jq -e '.toolComplete == true and .fenceValidated == false and
    .providerEnforcementValidated == false and .fenceEvidenceDigest != null' \
    "$TEST_TMP/final-checkpoint/final-inventory.json" >/dev/null &&
  jq -e '.fenceEvidenceDigest == null' \
    "$TEST_TMP/final-checkpoint/provisional/source/index-receipt-000001.json" >/dev/null &&
  jq -e '.fenceEvidenceDigest != null' \
    "$TEST_TMP/final-checkpoint/fenced/source/index-receipt-000001.json" >/dev/null &&
  grep -Eq $'^source\tget-object\t.*--key raw/stable.txt' "$AWS_LOG"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/drift.txt alpha; put_fixture destination dst raw/drift.txt alpha
run_tool inventory "$TEST_TMP/reports/drift-provisional" \
  --checkpoint-dir "$TEST_TMP/drift-checkpoint" --page-size 1 --time-budget-seconds 30 >/dev/null
put_fixture source src raw/drift.txt bravo; put_fixture destination dst raw/drift.txt bravo
printf 'writers fenced\n' >"$TEST_TMP/drift-fence.txt"
TEST_NAME='fenced finalization rejects body drift hidden by stable size and ETag'
expect_status 1 run_tool inventory "$TEST_TMP/reports/drift-fenced" \
  --checkpoint-dir "$TEST_TMP/drift-checkpoint" --page-size 1 --time-budget-seconds 30 \
  --fence-record "$TEST_TMP/drift-fence.txt" --resume
if [ ! -e "$TEST_TMP/drift-checkpoint/final-inventory.json" ] &&
  jq -e '.inventoryCheckpoint.toolComplete == false and
    (.missingProof | index("fenced checkpoint differs from provisional whole-bucket evidence"))' \
    "$TEST_TMP/reports/drift-fenced/summary.json" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/a.txt alpha; put_fixture source src raw/b.txt beta
put_fixture destination dst raw/a.txt alpha; put_fixture destination dst raw/b.txt beta
run_tool inventory "$TEST_TMP/reports/fenced-resume-provisional" \
  --checkpoint-dir "$TEST_TMP/fenced-resume" --page-size 1 --time-budget-seconds 30 >/dev/null
printf 'writers fenced\n' >"$TEST_TMP/fenced-resume-fence.txt"; FAKE_CLOCK_STEP=2
TEST_NAME='fenced rescan is itself bounded and resumable'
expect_status 1 run_tool inventory "$TEST_TMP/reports/fenced-resume-first" \
  --checkpoint-dir "$TEST_TMP/fenced-resume" --page-size 1 --time-budget-seconds 1 \
  --fence-record "$TEST_TMP/fenced-resume-fence.txt" --resume
if jq -e '.phase == "fenced" and .resumeRequired == true' \
    "$TEST_TMP/fenced-resume/progress.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi
unset FAKE_CLOCK_STEP; : >"$AWS_LOG"
TEST_NAME='fenced resume restarts after its last committed key'
expect_ok run_tool inventory "$TEST_TMP/reports/fenced-resume-second" \
  --checkpoint-dir "$TEST_TMP/fenced-resume" --page-size 1 --time-budget-seconds 30 \
  --fence-record "$TEST_TMP/fenced-resume-fence.txt" --resume
if grep -Eq $'^source\tlist-objects-v2\t.*--start-after raw/a.txt' "$AWS_LOG" &&
  jq -e '.toolComplete == true and .fenceValidated == false' \
    "$TEST_TMP/fenced-resume/final-inventory.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
FAKE_FAIL_SIDE=destination FAKE_FAIL_OPERATION=head-bucket FAKE_FAIL_ATTEMPTS=99
TEST_NAME='fails when the credential cannot prove the exact destination target'
expect_bad run_tool inventory "$TEST_TMP/reports/target-identity" --retries 1

reset_store
put_fixture source src raw/inventory-proof.txt payload
TEST_NAME='executed copy exits one without finalized inventory evidence'
expect_status 1 run_tool_without_inventory copy "$TEST_TMP/reports/no-inventory-proof" --execute-copy
TEST_NAME='missing inventory proof prevents listing and every destination write'
if ! grep -Eq $'\t(list-objects-v2|put-object)\t' "$AWS_LOG" &&
  jq -e '.inventoryProof.required == true and .inventoryProof.accepted == false and
    (.missingProof | index("executed copy requires a finalized inventory proof"))' \
    "$TEST_TMP/reports/no-inventory-proof/summary.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/capability.txt capability
TEST_NAME='execute-copy exits one without conditional-write capability evidence'
expect_status 1 run_tool_without_capability copy "$TEST_TMP/reports/no-capability" --execute-copy
TEST_NAME='missing capability evidence prevents destination writes and is receipted'
if [ ! -e "$TEST_TMP/store/destination/dst/objects/raw/capability.txt" ] &&
  ! grep -Eq $'^destination\tput-object\t' "$AWS_LOG" &&
  jq -e '.conditionalWriteCapability.required == true and
    .conditionalWriteCapability.proofAccepted == false and
    (.missingProof | index("conditional-write capability proof is absent"))' \
    "$TEST_TMP/reports/no-capability/summary.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/mismatched-capability.txt capability
jq '.destination.bucket = "other"' "$TEST_TMP/conditional-write-proof.json" \
  >"$TEST_TMP/mismatched-capability.json"
TEST_NAME='execute-copy exits one with mismatched conditional-write evidence'
expect_status 1 run_tool copy "$TEST_TMP/reports/mismatched-capability" --execute-copy \
  --conditional-write-proof "$TEST_TMP/mismatched-capability.json"
TEST_NAME='mismatched capability evidence prevents every destination write'
if [ ! -e "$TEST_TMP/store/destination/dst/objects/raw/mismatched-capability.txt" ] &&
  ! grep -Eq $'^destination\tput-object\t' "$AWS_LOG"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

for mutation in long-lived expired wrong-identity wrong-capabilities; do
  case "$mutation" in
    long-lived) filter='.expiresAt = ((.observedAt | fromdateiso8601) + 172801 | todateiso8601)' ;;
    expired) filter='.observedAt = ((now - 7200) | todateiso8601) | .expiresAt = ((now - 3600) | todateiso8601)' ;;
    wrong-identity) filter='.identityFingerprint = ("b" * 64)' ;;
    wrong-capabilities) filter='.capabilities.ifMatchUpdate = false' ;;
  esac
  jq "$filter" "$TEST_TMP/conditional-write-proof.json" >"$TEST_TMP/$mutation-proof.json"
  TEST_NAME="rejects $mutation conditional-write evidence"
  expect_status 1 run_tool copy "$TEST_TMP/reports/$mutation-proof" --execute-copy \
    --conditional-write-proof "$TEST_TMP/$mutation-proof.json"
done

reset_store
put_fixture source src raw/empty-fence.txt payload
: >"$TEST_TMP/empty-copy-fence.txt"
TEST_NAME='empty fence exits one before a plain copy writes'
expect_status 1 run_tool copy "$TEST_TMP/reports/empty-copy-fence" --execute-copy \
  --fence-record "$TEST_TMP/empty-copy-fence.txt"
TEST_NAME='empty fence prevents every plain-copy destination write'
if [ ! -e "$TEST_TMP/store/destination/dst/objects/raw/empty-fence.txt" ] &&
  ! grep -Eq $'^destination\tput-object\t' "$AWS_LOG"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/a.txt alpha; put_fixture source src raw/b.txt beta
put_fixture destination dst raw/a.txt alpha; put_fixture destination dst raw/b.txt beta
FAKE_PAGE_SIZE=1
TEST_NAME='exhausts continuation-token pagination'
expect_ok run_tool verify "$TEST_TMP/reports/pages"
unset FAKE_PAGE_SIZE
TEST_NAME='records every source and destination page'
if [ "$(cat "$TEST_TMP/reports/pages/source-pages.txt")" = 2 ] &&
  [ "$(cat "$TEST_TMP/reports/pages/destination-pages.txt")" = 2 ]; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

reset_store
meta='{"ContentType":"text/plain","ContentEncoding":"gzip","CacheControl":"max-age=60","ContentDisposition":"inline","Metadata":{"origin":"municipal"},"TagSet":[{"Key":"plane","Value":"raw"}]}'
put_fixture source src raw/meta.txt payload "$meta"
TEST_NAME='copies a missing object and preserves metadata'
expect_ok run_tool copy "$TEST_TMP/reports/copy" --execute-copy
TEST_NAME='re-reads copied content and writes ownership evidence'
if cmp -s "$TEST_TMP/store/source/src/objects/raw/meta.txt" \
    "$TEST_TMP/store/destination/dst/objects/raw/meta.txt" &&
  jq -e '.counts.missing == 0 and .counts.conflicting == 0' \
    "$TEST_TMP/reports/copy/summary.json" >/dev/null &&
  jq -e '.object.metadata.origin == "municipal" and .object.tags[0].Key == "plane"' \
    "$TEST_TMP/reports/copy/copy-ledger.jsonl" >/dev/null &&
  jq -e '.inventoryProof.accepted == true and .inventoryProof.proofDigest != null' \
    "$TEST_TMP/reports/copy/summary.json" >/dev/null &&
  ! grep -Eq $'\tlist-objects-v2\t' "$AWS_LOG"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi
TEST_NAME='receipts bind accepted conditional-write evidence without validating it'
if jq -e '.conditionalWriteCapability.required == true and
  .conditionalWriteCapability.proofAccepted == true and
  .conditionalWriteCapability.proofDigest != null and
  .conditionalWriteCapability.providerEnforcementValidated == false' \
  "$TEST_TMP/reports/copy/summary.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/tampered-proof.txt payload
make_inventory_proof '' RAW
manual_proof="$GENERATED_INVENTORY_PROOF"; manual_fence="$GENERATED_FENCE"
jq '.source.fenced.objects += 1' "$manual_proof" >"$manual_proof.tmp" && mv "$manual_proof.tmp" "$manual_proof"
TEST_NAME='tampered inventory chain proof exits one before storage access'
expect_status 1 run_tool copy "$TEST_TMP/reports/tampered-proof-copy" --execute-copy \
  --inventory-proof "$manual_proof" --fence-record "$manual_fence"
if ! grep -Eq $'\t(list-objects-v2|put-object)\t' "$AWS_LOG" &&
  jq -e '.inventoryProof.accepted == false and
    (.missingProof | index("finalized inventory proof is invalid or mismatched"))' \
    "$TEST_TMP/reports/tampered-proof-copy/summary.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/multipart.bin same '{"ETag":"\"source-2\""}'
put_fixture destination dst raw/multipart.bin same '{"ETag":"\"destination-7\""}'
TEST_NAME='uses streamed SHA-256 instead of multipart ETags'
expect_ok run_tool verify "$TEST_TMP/reports/multipart"

reset_store
put_fixture source src raw/conflict.txt wanted
put_fixture destination dst raw/conflict.txt foreign
TEST_NAME='refuses a foreign destination conflict without overwrite'
expect_bad run_tool copy "$TEST_TMP/reports/conflict" --execute-copy
TEST_NAME='never invokes a delete and preserves foreign bytes'
if [ "$(cat "$TEST_TMP/store/destination/dst/objects/raw/conflict.txt")" = foreign ] &&
  ! grep -Eq $'\t(delete-object|delete-objects)\t' "$AWS_LOG"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
TEST_NAME='delta refuses to run without fence evidence'
expect_bad run_tool delta "$TEST_TMP/reports/no-fence"
TEST_NAME='delta names absent fence evidence in its summary'
if jq -e '.missingProof | index("delta fence record is absent")' \
  "$TEST_TMP/reports/no-fence/summary.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/a.txt alpha; put_fixture source src graph/a.json graph
TEST_NAME='classifies explicit disjoint exclusions'
expect_ok run_tool inventory "$TEST_TMP/reports/excluded" --exclude-prefix graph/
TEST_NAME='records the complete excluded object set'
if [ "$(jq -s length "$TEST_TMP/reports/excluded/excluded-source-manifest.jsonl")" = 1 ]; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi
TEST_NAME='blocks genuinely unclassified source keys'
expect_bad run_tool inventory "$TEST_TMP/reports/unclassified"

reset_store
put_fixture source src raw/retry.txt retry; put_fixture destination dst raw/retry.txt retry
FAKE_FAIL_SIDE=source FAKE_FAIL_OPERATION=head-object FAKE_FAIL_ATTEMPTS=2
TEST_NAME='retries a failed object operation up to the configured bound'
expect_ok run_tool verify "$TEST_TMP/reports/retry" --retries 3
TEST_NAME='uses exactly the configured retry bound'
if [ "$(grep -c $'^source\thead-object\t' "$AWS_LOG")" = 3 ]; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi
reset_store
put_fixture source src raw/a.txt a; put_fixture source src raw/b.txt b
FAKE_FAIL_SIDE=source FAKE_FAIL_OPERATION=head-object FAKE_FAIL_ATTEMPTS=99
TEST_NAME='aborts object evidence at the configured failure cap'
expect_bad run_tool inventory "$TEST_TMP/reports/cap" --retries 1 --max-failures 1
TEST_NAME='does not inspect a second object after reaching the cap'
if [ "$(grep -c $'^source\thead-object\t' "$AWS_LOG")" = 1 ]; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/unapproved.txt unapproved
printf '{}\n' >"$TEST_TMP/invalid-union.json"
TEST_NAME='invalid DOCS union prevents every destination write'
expect_bad run_tool copy "$TEST_TMP/reports/invalid-union-copy" --plane DOCS \
  --expected-manifest "$TEST_TMP/invalid-union.json" --execute-copy
TEST_NAME='invalid DOCS union leaves the destination untouched'
if [ ! -e "$TEST_TMP/store/destination/dst/objects/raw/unapproved.txt" ] &&
  ! grep -Eq $'^destination\tput-object\t' "$AWS_LOG"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/from-source.txt alpha
put_fixture destination dst raw/from-source.txt alpha
put_fixture destination dst raw/from-other.txt beta
run_tool inventory "$TEST_TMP/reports/union-evidence" >/dev/null 2>&1 || true
make_expected_union "$TEST_TMP/reports/union-evidence" "$TEST_TMP/expected-union.json"
TEST_NAME='accepts only union-approved destination extras'
expect_ok run_tool verify "$TEST_TMP/reports/union" --expected-manifest "$TEST_TMP/expected-union.json"
put_fixture source src raw/from-source.txt changed
TEST_NAME='rejects overlapping source provenance with different bytes'
expect_bad run_tool verify "$TEST_TMP/reports/overlap-bytes" \
  --expected-manifest "$TEST_TMP/expected-union.json"
rm -f "$TEST_TMP/store/destination/dst/objects/raw/from-source.txt" \
  "$TEST_TMP/store/destination/dst/meta/raw/from-source.txt.json"
: >"$AWS_LOG"
TEST_NAME='approved-union disagreement exits one before copy'
expect_status 1 run_tool copy "$TEST_TMP/reports/overlap-copy" --execute-copy \
  --expected-manifest "$TEST_TMP/expected-union.json"
TEST_NAME='approved-union disagreement leaves the destination untouched'
if [ ! -e "$TEST_TMP/store/destination/dst/objects/raw/from-source.txt" ] &&
  ! grep -Eq $'^destination\tput-object\t' "$AWS_LOG"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi
reset_store
put_fixture source src raw/from-source.txt alpha
put_fixture destination dst raw/from-source.txt alpha
put_fixture destination dst raw/from-other.txt beta
jq 'del(.sources[1].fenceSha256)' "$TEST_TMP/expected-union.json" >"$TEST_TMP/incomplete-union.json"
TEST_NAME='rejects incomplete per-source fenced observation provenance'
expect_bad run_tool verify "$TEST_TMP/reports/incomplete-union" \
  --expected-manifest "$TEST_TMP/incomplete-union.json"

reset_store
put_fixture source src raw/owned.txt original
run_tool copy "$TEST_TMP/reports/empty-fence-first" --execute-copy >/dev/null
put_fixture source src raw/owned.txt corrected
: >"$TEST_TMP/empty-fence.txt"; : >"$AWS_LOG"
TEST_NAME='empty fence prevents every owned-reconciliation write'
expect_bad run_tool copy "$TEST_TMP/reports/empty-fence-reconcile" --execute-copy --reconcile-owned \
  --ledger "$TEST_TMP/reports/empty-fence-first/copy-ledger.jsonl" \
  --fence-record "$TEST_TMP/empty-fence.txt"
TEST_NAME='empty fence leaves migration-owned destination bytes untouched'
if [ "$(cat "$TEST_TMP/store/destination/dst/objects/raw/owned.txt")" = original ] &&
  ! grep -Eq $'^destination\tput-object\t' "$AWS_LOG"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/owned.txt original
TEST_NAME='creates the exact ledger used by owned reconciliation'
expect_ok run_tool copy "$TEST_TMP/reports/owned-first" --execute-copy
put_fixture source src raw/owned.txt corrected
printf 'source and destination writers fenced\n' >"$TEST_TMP/fence.txt"
TEST_NAME='reconciles only the unchanged migration-owned version'
expect_ok run_tool copy "$TEST_TMP/reports/owned-reconcile" --execute-copy --reconcile-owned \
  --ledger "$TEST_TMP/reports/owned-first/copy-ledger.jsonl" --fence-record "$TEST_TMP/fence.txt"
TEST_NAME='records recoverable prior and distinct new versions and hashes'
if [ "$(cat "$TEST_TMP/store/destination/dst/objects/raw/owned.txt")" = corrected ] &&
  grep -Eq $'^destination\tget-object\t.*--version-id v1' "$AWS_LOG" &&
  jq -e '.prior.versionId == "v1" and .new.versionId == "v2" and
    .prior.sha256 != .new.sha256 and .fenceValidated == false' \
    "$TEST_TMP/reports/owned-reconcile/reconciliation-ledger.jsonl" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/owned.txt original
run_tool copy "$TEST_TMP/reports/no-version-first" --execute-copy >/dev/null
put_fixture source src raw/owned.txt corrected
printf 'fenced\n' >"$TEST_TMP/fence.txt"; : >"$AWS_LOG"; FAKE_VERSIONING=Suspended
TEST_NAME='refuses owned reconciliation without destination versioning'
expect_bad run_tool copy "$TEST_TMP/reports/no-version-reconcile" --execute-copy --reconcile-owned \
  --ledger "$TEST_TMP/reports/no-version-first/copy-ledger.jsonl" --fence-record "$TEST_TMP/fence.txt"
TEST_NAME='does not write after absent-versioning refusal'
if ! grep -Eq $'^destination\tput-object\t' "$AWS_LOG"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/owned.txt original
run_tool copy "$TEST_TMP/reports/foreign-first" --execute-copy >/dev/null
put_fixture source src raw/owned.txt corrected
put_fixture destination dst raw/owned.txt independently-modified
printf 'fenced\n' >"$TEST_TMP/fence.txt"; : >"$AWS_LOG"
TEST_NAME='refuses an independently changed object despite a prior ledger'
expect_bad run_tool copy "$TEST_TMP/reports/foreign-reconcile" --execute-copy --reconcile-owned \
  --ledger "$TEST_TMP/reports/foreign-first/copy-ledger.jsonl" --fence-record "$TEST_TMP/fence.txt"
TEST_NAME='keeps independently modified destination bytes untouched'
if [ "$(cat "$TEST_TMP/store/destination/dst/objects/raw/owned.txt")" = independently-modified ] &&
  ! grep -Eq $'^destination\tput-object\t' "$AWS_LOG"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

reset_store
put_fixture source src raw/delta.txt identical; put_fixture destination dst raw/delta.txt identical
printf 'fenced\n' >"$TEST_TMP/fence.txt"
TEST_NAME='marks only an identical fenced delta as tool-ready'
expect_ok run_tool delta "$TEST_TMP/reports/delta" --fence-record "$TEST_TMP/fence.txt"
TEST_NAME='records fence digest without claiming fence validation'
if jq -e '.cutoverReady == true and .fenceEvidenceDigest != null and .fenceValidated == false' \
  "$TEST_TMP/reports/delta/summary.json" >/dev/null; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
