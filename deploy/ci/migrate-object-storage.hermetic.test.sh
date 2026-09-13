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
if [ "${FAKE_FAIL_SIDE:-}" = "$side" ] && [ "${FAKE_FAIL_OPERATION:-}" = "$op" ]; then
  counter="$FAKE_S3_TMP/failure-counter"; seen="$(cat "$counter" 2>/dev/null || printf 0)"
  if [ "$seen" -lt "${FAKE_FAIL_ATTEMPTS:-0}" ]; then
    printf '%s' "$((seen + 1))" >"$counter"; exit 71
  fi
fi
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
objects="$root/$bucket/objects"; meta="$root/$bucket/meta"
object="$objects/$key"; metadata="$meta/$key.json"
case "$op" in
  head-bucket)
    [ -d "$objects" ] || exit 44
    printf '{}\n'
    ;;
  list-objects-v2)
    start="$(arg --continuation-token "$@")"; start="${start:-0}"
    page_size="${FAKE_PAGE_SIZE:-1000}"; all="$FAKE_S3_TMP/all.jsonl"; : >"$all"
    if [ -d "$objects" ]; then
      while IFS= read -r file; do
        rel="${file#"$objects/"}"; size="$(wc -c <"$file")"
        etag="$(jq -r '.ETag // "etag"' "$meta/$rel.json")"
        jq -cn --arg key "$rel" --argjson size "$size" --arg etag "$etag" \
          '{Key:$key,Size:$size,ETag:$etag}' >>"$all"
      done < <(find "$objects" -type f | sort)
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

PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
expect_ok() {
  local log="$TEST_TMP/last-command.log"
  if "$@" >"$log" 2>&1; then ok "$TEST_NAME"; else bad "$TEST_NAME"; cat "$log" >&2; fi
}
expect_bad() { "$@" >/dev/null 2>&1 && bad "$TEST_NAME" || ok "$TEST_NAME"; }

reset_store() {
  rm -rf "$TEST_TMP/store" "$TEST_TMP/reports"
  mkdir -p "$TEST_TMP/store/source/src/objects" "$TEST_TMP/store/source/src/meta" \
    "$TEST_TMP/store/destination/dst/objects" "$TEST_TMP/store/destination/dst/meta" \
    "$TEST_TMP/reports"
  : >"$AWS_LOG"; rm -f "$TEST_TMP/version"
  unset FAKE_FAIL_SIDE FAKE_FAIL_OPERATION FAKE_FAIL_ATTEMPTS FAKE_VERSIONING
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
run_tool() {
  local operation="$1" report="$2" status; shift 2
  env PATH="$TEST_TMP/bin:$PATH" FAKE_S3_ROOT="$TEST_TMP/store" \
    FAKE_S3_TMP="$TEST_TMP" FAKE_AWS_LOG="$AWS_LOG" \
    FAKE_PAGE_SIZE="${FAKE_PAGE_SIZE:-1000}" FAKE_VERSIONING="${FAKE_VERSIONING:-Enabled}" \
    FAKE_FAIL_SIDE="${FAKE_FAIL_SIDE:-}" FAKE_FAIL_OPERATION="${FAKE_FAIL_OPERATION:-}" \
    FAKE_FAIL_ATTEMPTS="${FAKE_FAIL_ATTEMPTS:-0}" \
    MIGRATION_RUN_ID=test-run MIGRATION_SOURCE_ACCESS_KEY_ID=SRC_KEY \
    MIGRATION_SOURCE_SECRET_ACCESS_KEY=SRC_SECRET \
    MIGRATION_DESTINATION_ACCESS_KEY_ID=DST_KEY \
    MIGRATION_DESTINATION_SECRET_ACCESS_KEY=DST_SECRET \
    "$TOOL" "$operation" "${BASE_ARGS[@]}" --report-dir "$report" "$@"
  status=$?
  [ "$status" -eq 0 ] || {
    [ ! -f "$report/summary.json" ] || jq . "$report/summary.json" >&2
    cat "$AWS_LOG" >&2
  }
  return "$status"
}

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
FAKE_FAIL_SIDE=destination FAKE_FAIL_OPERATION=head-bucket FAKE_FAIL_ATTEMPTS=99
TEST_NAME='fails when the credential cannot prove the exact destination target'
expect_bad run_tool inventory "$TEST_TMP/reports/target-identity" --retries 1

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
    "$TEST_TMP/reports/copy/copy-ledger.jsonl" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

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
reset_store
put_fixture source src raw/a.txt a; put_fixture source src raw/b.txt b
FAKE_FAIL_SIDE=source FAKE_FAIL_OPERATION=head-object FAKE_FAIL_ATTEMPTS=99
TEST_NAME='aborts object evidence at the configured failure cap'
expect_bad run_tool inventory "$TEST_TMP/reports/cap" --retries 1 --max-failures 1
TEST_NAME='does not inspect a second object after reaching the cap'
if [ "$(grep -c $'^source\thead-object\t' "$AWS_LOG")" = 1 ]; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

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
