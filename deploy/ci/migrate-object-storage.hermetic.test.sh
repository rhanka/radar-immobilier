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
set -uo pipefail
side=destination
[ "${AWS_ACCESS_KEY_ID:-}" = SRC_KEY ] && side=source
root="$FAKE_S3_ROOT/$side"; log="$FAKE_AWS_LOG"
while [ "$#" -gt 0 ] && [ "$1" != s3api ]; do shift; done
[ "${1:-}" = s3api ] || exit 90
shift; op="$1"; shift
printf '%s\t%s\t%s\n' "$side" "$op" "$*" >>"$log"
arg() {
  local wanted="$1" previous="" value
  shift
  for value in "$@"; do
    [ "$previous" = "$wanted" ] && { printf '%s' "$value"; return; }
    previous="$value"
  done
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
    jq -sn --slurpfile items "$all" --argjson start "$start" --argjson size "$page_size" '
      ($items | length) as $total | ($items[$start:($start+$size)]) as $page |
      {Contents:$page,IsTruncated:($start+$size < $total),
       NextContinuationToken:(if $start+$size < $total then (($start+$size)|tostring) else null end)}'
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
    user_meta="$(arg --metadata "$@")"; user_meta="${user_meta:-{}}"
    tagging="$(arg --tagging "$@")"
    tags="$(printf '%s' "$tagging" | jq -R 'if length == 0 then [] else
      split("&") | map(split("=") | {Key:.[0],Value:.[1]}) end')"
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
expect_ok() { "$@" >/dev/null 2>&1 && ok "$TEST_NAME" || bad "$TEST_NAME"; }
expect_bad() { "$@" >/dev/null 2>&1 && bad "$TEST_NAME" || ok "$TEST_NAME"; }
