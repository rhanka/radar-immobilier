#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: migrate-object-storage.sh <inventory|copy|verify|delta> [options]
  --environment <preprod|prod> --plane <RAW|DOCS>
  --source-endpoint URL --source-region REGION --source-bucket BUCKET
  --source-path-style <true|false>
  --destination-endpoint URL --destination-region REGION
  --destination-bucket BUCKET --destination-path-style <true|false>
  --prefix PREFIX/ [--prefix PREFIX/ ...] --report-dir DIR
  [--exclude-prefix PREFIX/ ...] [--expected-manifest FILE]
  [--execute-copy] [--fence-record FILE]
  [--reconcile-owned --ledger FILE]
  [--concurrency N] [--retries N] [--max-failures N]
  [--max-object-bytes N]
EOF
  exit 2
}

die() { echo "ERROR: $*" >&2; exit 2; }
need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 requires a value"; }

[ "$#" -ge 1 ] || usage
OPERATION="$1"; shift
ENVIRONMENT="" PLANE="" REPORT_DIR="" EXECUTE_COPY=false RECONCILE_OWNED=false
SOURCE_ENDPOINT="" SOURCE_REGION="" SOURCE_BUCKET="" SOURCE_PATH_STYLE=""
DESTINATION_ENDPOINT="" DESTINATION_REGION="" DESTINATION_BUCKET=""
DESTINATION_PATH_STYLE="" EXPECTED_MANIFEST="" FENCE_RECORD="" LEDGER=""
CONCURRENCY=4 RETRIES=3 MAX_FAILURES=20 MAX_OBJECT_BYTES=5000000000
PREFIXES=() EXCLUDE_PREFIXES=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment) need_value "$@"; ENVIRONMENT="$2"; shift 2 ;;
    --plane) need_value "$@"; PLANE="$2"; shift 2 ;;
    --source-endpoint) need_value "$@"; SOURCE_ENDPOINT="$2"; shift 2 ;;
    --source-region) need_value "$@"; SOURCE_REGION="$2"; shift 2 ;;
    --source-bucket) need_value "$@"; SOURCE_BUCKET="$2"; shift 2 ;;
    --source-path-style) need_value "$@"; SOURCE_PATH_STYLE="$2"; shift 2 ;;
    --destination-endpoint) need_value "$@"; DESTINATION_ENDPOINT="$2"; shift 2 ;;
    --destination-region) need_value "$@"; DESTINATION_REGION="$2"; shift 2 ;;
    --destination-bucket) need_value "$@"; DESTINATION_BUCKET="$2"; shift 2 ;;
    --destination-path-style) need_value "$@"; DESTINATION_PATH_STYLE="$2"; shift 2 ;;
    --prefix) need_value "$@"; PREFIXES+=("$2"); shift 2 ;;
    --exclude-prefix) need_value "$@"; EXCLUDE_PREFIXES+=("$2"); shift 2 ;;
    --report-dir) need_value "$@"; REPORT_DIR="$2"; shift 2 ;;
    --expected-manifest) need_value "$@"; EXPECTED_MANIFEST="$2"; shift 2 ;;
    --fence-record) need_value "$@"; FENCE_RECORD="$2"; shift 2 ;;
    --ledger) need_value "$@"; LEDGER="$2"; shift 2 ;;
    --execute-copy) EXECUTE_COPY=true; shift ;;
    --reconcile-owned) RECONCILE_OWNED=true; shift ;;
    --concurrency) need_value "$@"; CONCURRENCY="$2"; shift 2 ;;
    --retries) need_value "$@"; RETRIES="$2"; shift 2 ;;
    --max-failures) need_value "$@"; MAX_FAILURES="$2"; shift 2 ;;
    --max-object-bytes) need_value "$@"; MAX_OBJECT_BYTES="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) die "unsupported argument: $1" ;;
  esac
done

case "$OPERATION" in inventory|copy|verify|delta) ;; *) usage ;; esac
case "$ENVIRONMENT" in preprod|prod) ;; *) die 'invalid environment' ;; esac
case "$PLANE" in RAW|DOCS) ;; *) die 'invalid plane' ;; esac
[ "$OPERATION" = copy ] || { ! $EXECUTE_COPY && ! $RECONCILE_OWNED; } || \
  die 'copy flags are valid only with the copy operation'
$RECONCILE_OWNED && $EXECUTE_COPY || ! $RECONCILE_OWNED || \
  die '--reconcile-owned requires --execute-copy'
$RECONCILE_OWNED && [ -n "$LEDGER" ] || ! $RECONCILE_OWNED || \
  die '--reconcile-owned requires --ledger'
$RECONCILE_OWNED && [ -n "$FENCE_RECORD" ] || ! $RECONCILE_OWNED || \
  die '--reconcile-owned requires --fence-record'
[ "$OPERATION" != delta ] || [ -n "$FENCE_RECORD" ] || \
  die 'delta requires --fence-record'

validate_endpoint() {
  [[ "$2" =~ ^https?://[^/@?#]+$ ]] || die "$1 must be an http(s) origin without credentials"
}
validate_scalar() {
  [ -n "$2" ] && [[ "$2" != *[[:space:]/]* ]] || die "$1 is invalid"
}
validate_path_style() {
  case "$2" in true|false) ;; *) die "$1 must be true or false" ;; esac
}
validate_limit() {
  local label="$1" value="$2" ceiling="$3"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] && [ "$value" -le "$ceiling" ] || \
    die "$label must be between 1 and $ceiling"
}
validate_prefix() {
  local label="$1" value="$2"
  [ -n "$value" ] && [[ "$value" == */ ]] && [[ "$value" != /* ]] &&
    [[ ! "$value" =~ (^|/)\.\.?(/|$) ]] || die "$label is invalid: $value"
}
overlaps() { [[ "$1" == "$2"* || "$2" == "$1"* ]]; }

validate_endpoint --source-endpoint "$SOURCE_ENDPOINT"
validate_endpoint --destination-endpoint "$DESTINATION_ENDPOINT"
validate_scalar --source-region "$SOURCE_REGION"; validate_scalar --source-bucket "$SOURCE_BUCKET"
validate_scalar --destination-region "$DESTINATION_REGION"
validate_scalar --destination-bucket "$DESTINATION_BUCKET"
validate_path_style --source-path-style "$SOURCE_PATH_STYLE"
validate_path_style --destination-path-style "$DESTINATION_PATH_STYLE"
validate_limit --concurrency "$CONCURRENCY" 32; validate_limit --retries "$RETRIES" 10
validate_limit --max-failures "$MAX_FAILURES" 100
validate_limit --max-object-bytes "$MAX_OBJECT_BYTES" 5000000000
[ "${#PREFIXES[@]}" -gt 0 ] || die 'at least one --prefix is required'
for prefix in "${PREFIXES[@]}"; do validate_prefix --prefix "$prefix"; done
for prefix in "${EXCLUDE_PREFIXES[@]}"; do validate_prefix --exclude-prefix "$prefix"; done
for ((i=0; i<${#PREFIXES[@]}; i++)); do
  for ((j=i+1; j<${#PREFIXES[@]}; j++)); do
    ! overlaps "${PREFIXES[i]}" "${PREFIXES[j]}" || die 'included prefixes overlap'
  done
  for excluded in "${EXCLUDE_PREFIXES[@]}"; do
    ! overlaps "${PREFIXES[i]}" "$excluded" || die 'included and excluded prefixes overlap'
  done
done
for ((i=0; i<${#EXCLUDE_PREFIXES[@]}; i++)); do
  for ((j=i+1; j<${#EXCLUDE_PREFIXES[@]}; j++)); do
    ! overlaps "${EXCLUDE_PREFIXES[i]}" "${EXCLUDE_PREFIXES[j]}" || die 'excluded prefixes overlap'
  done
done

SOURCE_ENDPOINT="${SOURCE_ENDPOINT%/}"; DESTINATION_ENDPOINT="${DESTINATION_ENDPOINT%/}"
SOURCE_TUPLE="${SOURCE_ENDPOINT,,}|${SOURCE_REGION,,}|$SOURCE_BUCKET|$SOURCE_PATH_STYLE"
DESTINATION_TUPLE="${DESTINATION_ENDPOINT,,}|${DESTINATION_REGION,,}|$DESTINATION_BUCKET|$DESTINATION_PATH_STYLE"
[ "$SOURCE_TUPLE" != "$DESTINATION_TUPLE" ] || die 'source and destination tuples must differ'
for credential in MIGRATION_SOURCE_ACCESS_KEY_ID MIGRATION_SOURCE_SECRET_ACCESS_KEY \
  MIGRATION_DESTINATION_ACCESS_KEY_ID MIGRATION_DESTINATION_SECRET_ACCESS_KEY; do
  [ -n "${!credential:-}" ] || die "$credential is required"
done
[ "$MIGRATION_SOURCE_ACCESS_KEY_ID" != "$MIGRATION_DESTINATION_ACCESS_KEY_ID" ] || \
  die 'source and destination migration identities must differ'
[ -n "$REPORT_DIR" ] || die '--report-dir is required'
[ ! -e "$REPORT_DIR/summary.json" ] || die 'report directory already contains a summary'
mkdir -p "$REPORT_DIR" || die 'cannot create report directory'

for command in aws jq sha256sum mktemp; do
  command -v "$command" >/dev/null 2>&1 || die "$command is required"
done
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/object-storage-migration.XXXXXX")" || \
  die 'cannot create work directory'
trap 'rm -rf "$WORK_DIR"' EXIT
SOURCE_CONFIG="$WORK_DIR/source-aws-config"
DESTINATION_CONFIG="$WORK_DIR/destination-aws-config"
write_aws_config() {
  local file="$1" region="$2" style="$3" addressing=virtual
  [ "$style" = false ] || addressing=path
  printf '[default]\nregion = %s\ns3 =\n  addressing_style = %s\n' \
    "$region" "$addressing" >"$file"
  chmod 600 "$file"
}
write_aws_config "$SOURCE_CONFIG" "$SOURCE_REGION" "$SOURCE_PATH_STYLE"
write_aws_config "$DESTINATION_CONFIG" "$DESTINATION_REGION" "$DESTINATION_PATH_STYLE"

credential_fingerprint() { printf '%s' "$1" | sha256sum | awk '{print $1}'; }
SOURCE_IDENTITY_FINGERPRINT="$(credential_fingerprint "$MIGRATION_SOURCE_ACCESS_KEY_ID")"
DESTINATION_IDENTITY_FINGERPRINT="$(credential_fingerprint "$MIGRATION_DESTINATION_ACCESS_KEY_ID")"
AWS_COMMON=(--no-cli-pager --no-paginate --output json)
aws_side() {
  local side="$1" endpoint region access secret config
  shift
  if [ "$side" = source ]; then
    endpoint="$SOURCE_ENDPOINT"; region="$SOURCE_REGION"
    access="$MIGRATION_SOURCE_ACCESS_KEY_ID"; secret="$MIGRATION_SOURCE_SECRET_ACCESS_KEY"
    config="$SOURCE_CONFIG"
  else
    endpoint="$DESTINATION_ENDPOINT"; region="$DESTINATION_REGION"
    access="$MIGRATION_DESTINATION_ACCESS_KEY_ID"
    secret="$MIGRATION_DESTINATION_SECRET_ACCESS_KEY"; config="$DESTINATION_CONFIG"
  fi
  AWS_ACCESS_KEY_ID="$access" AWS_SECRET_ACCESS_KEY="$secret" AWS_SESSION_TOKEN= \
    AWS_CONFIG_FILE="$config" AWS_EC2_METADATA_DISABLED=true \
    aws "${AWS_COMMON[@]}" --endpoint-url "$endpoint" --region "$region" s3api "$@"
}

retry_json() {
  local output="$1" side="$2" attempt=1
  shift 2
  while [ "$attempt" -le "$RETRIES" ]; do
    if aws_side "$side" "$@" >"$output" 2>"$WORK_DIR/aws-error"; then return 0; fi
    attempt=$((attempt + 1))
  done
  return 1
}

bucket_for() {
  if [ "$1" = source ]; then printf '%s' "$SOURCE_BUCKET"; else printf '%s' "$DESTINATION_BUCKET"; fi
}
validate_target() {
  local side="$1" bucket output="$WORK_DIR/$1-head-bucket.json"
  bucket="$(bucket_for "$side")"
  retry_json "$output" "$side" head-bucket --bucket "$bucket" || return 1
}

list_objects() {
  local side="$1" output="$2" bucket token="" page=0 response next truncated
  bucket="$(bucket_for "$side")"; : >"$output"
  while :; do
    page=$((page + 1)); response="$WORK_DIR/$side-page-$page.json"
    args=(list-objects-v2 --bucket "$bucket" --max-keys 1000)
    [ -z "$token" ] || args+=(--continuation-token "$token")
    retry_json "$response" "$side" "${args[@]}" || return 1
    jq -ce '.Contents[]? | {key:.Key,size:.Size,etag:(.ETag // "")}' \
      "$response" >>"$output" || return 1
    truncated="$(jq -r '.IsTruncated // false' "$response")"
    [ "$truncated" = true ] || break
    next="$(jq -r '.NextContinuationToken // empty' "$response")"
    [ -n "$next" ] || return 1
    token="$next"
  done
  printf '%s\n' "$page" >"$REPORT_DIR/$side-pages.txt"
}

matches_any() {
  local key="$1" prefix
  shift
  for prefix in "$@"; do [[ "$key" == "$prefix"* ]] && return 0; done
  return 1
}
classify_key() {
  local key="$1"
  if matches_any "$key" "${PREFIXES[@]}"; then
    printf included
  elif matches_any "$key" "${EXCLUDE_PREFIXES[@]}"; then
    printf excluded
  else
    printf unclassified
  fi
}

FAILURE_COUNT=0
: >"$REPORT_DIR/failures.jsonl"
record_failure() {
  local side="$1" key="$2" operation="$3"
  FAILURE_COUNT=$((FAILURE_COUNT + 1))
  jq -cn --arg side "$side" --arg key "$key" --arg operation "$operation" \
    '{side:$side,key:$key,operation:$operation}' >>"$REPORT_DIR/failures.jsonl"
}
failure_cap_reached() { [ "$FAILURE_COUNT" -ge "$MAX_FAILURES" ]; }

retry_get_object() {
  local output="$1" body="$2" side="$3" bucket="$4" key="$5" attempt=1
  while [ "$attempt" -le "$RETRIES" ]; do
    rm -f "$body"
    if aws_side "$side" get-object --bucket "$bucket" --key "$key" "$body" \
      >"$output" 2>"$WORK_DIR/aws-error"; then return 0; fi
    attempt=$((attempt + 1))
  done
  rm -f "$body"
  return 1
}

build_manifest() {
  local side="$1" listing="$2" output="$3" bucket item key size class index=0
  local head tags body getout sha scratch="$WORK_DIR/$side-manifest.unsorted.jsonl"
  bucket="$(bucket_for "$side")"; : >"$scratch"
  while IFS= read -r item; do
    index=$((index + 1)); key="$(jq -r '.key' <<<"$item")"
    size="$(jq -r '.size' <<<"$item")"; class="$(classify_key "$key")"
    if [ "$size" -gt "$MAX_OBJECT_BYTES" ]; then
      record_failure "$side" "$key" max-object-bytes
      failure_cap_reached && break
      continue
    fi
    head="$WORK_DIR/$side-head-$index.json"; tags="$WORK_DIR/$side-tags-$index.json"
    body="$WORK_DIR/$side-body-$index"; getout="$WORK_DIR/$side-get-$index.json"
    if ! retry_json "$head" "$side" head-object --bucket "$bucket" --key "$key"; then
      record_failure "$side" "$key" head-object
      failure_cap_reached && break
      continue
    fi
    if ! retry_get_object "$getout" "$body" "$side" "$bucket" "$key"; then
      record_failure "$side" "$key" get-object
      failure_cap_reached && break
      continue
    fi
    if ! retry_json "$tags" "$side" get-object-tagging --bucket "$bucket" --key "$key"; then
      record_failure "$side" "$key" get-object-tagging
      rm -f "$body"; failure_cap_reached && break
      continue
    fi
    if [ "$(jq -r '.ContentLength' "$head")" != "$size" ]; then
      record_failure "$side" "$key" unstable-size
      rm -f "$body"; failure_cap_reached && break
      continue
    fi
    sha="$(sha256sum "$body" | awk '{print $1}')"; rm -f "$body"
    jq -cn --argjson listed "$item" --slurpfile head "$head" --slurpfile tags "$tags" \
      --arg sha "$sha" --arg classification "$class" '
      {key:$listed.key,size:$head[0].ContentLength,sha256:$sha,
       contentType:($head[0].ContentType // null),
       contentEncoding:($head[0].ContentEncoding // null),
       cacheControl:($head[0].CacheControl // null),
       contentDisposition:($head[0].ContentDisposition // null),
       metadata:($head[0].Metadata // {}),tags:(($tags[0].TagSet // []) | sort_by(.Key)),
       etag:($listed.etag // ""),versionId:($head[0].VersionId // null),
       classification:$classification}' >>"$scratch" || return 1
  done <"$listing"
  jq -cs 'sort_by(.key)[]' "$scratch" >"$output" || return 1
  ! failure_cap_reached
}

MISSING_PROOF=()
add_missing_proof() { MISSING_PROOF+=("$1"); }
SOURCE_LISTING="$WORK_DIR/source-listing.jsonl"
DESTINATION_LISTING="$WORK_DIR/destination-listing.jsonl"
SOURCE_MANIFEST="$REPORT_DIR/source-manifest.jsonl"
DESTINATION_MANIFEST="$REPORT_DIR/destination-manifest.jsonl"

inventory_side() {
  local side="$1" listing="$2" manifest="$3"
  : >"$listing"; : >"$manifest"
  if ! validate_target "$side"; then
    record_failure "$side" '' head-bucket
    add_missing_proof "$side target identity or bucket access is unproved"
    return 1
  fi
  if ! list_objects "$side" "$listing"; then
    record_failure "$side" '' list-objects-v2
    add_missing_proof "$side complete listing is unavailable"
    return 1
  fi
  if ! build_manifest "$side" "$listing" "$manifest"; then
    add_missing_proof "$side object evidence is incomplete"
    return 1
  fi
}

inventory_side source "$SOURCE_LISTING" "$SOURCE_MANIFEST" || true
inventory_side destination "$DESTINATION_LISTING" "$DESTINATION_MANIFEST" || true
jq -c 'select(.classification == "included")' "$SOURCE_MANIFEST" \
  >"$REPORT_DIR/source-included-manifest.jsonl"
jq -c 'select(.classification == "excluded")' "$SOURCE_MANIFEST" \
  >"$REPORT_DIR/excluded-source-manifest.jsonl"
jq -c 'select(.classification == "unclassified")' "$SOURCE_MANIFEST" \
  >"$REPORT_DIR/unclassified-source-manifest.jsonl"
if [ -s "$REPORT_DIR/unclassified-source-manifest.jsonl" ]; then
  add_missing_proof 'source contains unclassified keys'
fi

EXPECTED_MANIFEST_DIGEST=null
EXPECTED_OBJECTS="$REPORT_DIR/expected-objects.jsonl"
: >"$EXPECTED_OBJECTS"
validate_expected_manifest() {
  [ -r "$EXPECTED_MANIFEST" ] && [ -s "$EXPECTED_MANIFEST" ] || return 1
  jq -e '
    .schemaVersion == 1 and (.sources | type == "array" and length > 0) and
    (.objects | type == "array") and
    ([.objects[].key] | length == (unique | length)) and
    all(.sources[];
      (.endpoint | type == "string" and length > 0) and
      (.region | type == "string" and length > 0) and
      (.bucket | type == "string" and length > 0) and
      (.pathStyle == true or .pathStyle == false)) and
    all(.objects[];
      (.key | type == "string" and length > 0) and
      (.size | type == "number" and . >= 0) and
      (.sha256 | test("^[0-9a-f]{64}$")) and
      (.metadata | type == "object") and (.tags | type == "array") and
      (.sources | type == "array" and length > 0))
  ' "$EXPECTED_MANIFEST" >/dev/null || return 1
  local source_count
  source_count="$(jq '.sources | length' "$EXPECTED_MANIFEST")"
  if [ "$source_count" -gt 1 ]; then
    jq -e 'all(.sources[];
      (.observedAt | type == "string" and length > 0) and
      (.manifestSha256 | test("^[0-9a-f]{64}$")) and
      (.fenceSha256 | test("^[0-9a-f]{64}$")))' \
      "$EXPECTED_MANIFEST" >/dev/null || return 1
  fi
  jq -e --arg endpoint "$SOURCE_ENDPOINT" --arg region "$SOURCE_REGION" \
    --arg bucket "$SOURCE_BUCKET" --argjson pathStyle "$SOURCE_PATH_STYLE" '
    any(.sources[]; .endpoint == $endpoint and .region == $region and
      .bucket == $bucket and .pathStyle == $pathStyle)' \
    "$EXPECTED_MANIFEST" >/dev/null || return 1
  jq -cs --argfile expected "$EXPECTED_MANIFEST" '
    $expected.objects | sort_by(.key)[] |
    . + {contentType:(.contentType // null),contentEncoding:(.contentEncoding // null),
      cacheControl:(.cacheControl // null),contentDisposition:(.contentDisposition // null),
      metadata:(.metadata // {}),tags:((.tags // []) | sort_by(.Key))}' \
    </dev/null >"$EXPECTED_OBJECTS" || return 1
}
if [ -n "$EXPECTED_MANIFEST" ]; then
  if validate_expected_manifest; then
    EXPECTED_MANIFEST_DIGEST="$(sha256sum "$EXPECTED_MANIFEST" | awk '{print $1}')"
  else
    add_missing_proof 'expected manifest is invalid or lacks complete source provenance'
  fi
fi

TARGET_MANIFEST="$REPORT_DIR/source-included-manifest.jsonl"
EXPECTED_SOURCE_CONFLICTS="$REPORT_DIR/expected-source-conflicts.jsonl"
: >"$EXPECTED_SOURCE_CONFLICTS"
if [ "$EXPECTED_MANIFEST_DIGEST" != null ]; then
  TARGET_MANIFEST="$EXPECTED_OBJECTS"
  jq -cn --slurpfile observed "$REPORT_DIR/source-included-manifest.jsonl" \
    --slurpfile expected "$EXPECTED_OBJECTS" --argfile contract "$EXPECTED_MANIFEST" \
    --arg endpoint "$SOURCE_ENDPOINT" --arg region "$SOURCE_REGION" \
    --arg bucket "$SOURCE_BUCKET" --argjson pathStyle "$SOURCE_PATH_STYLE" '
    def core: del(.etag,.versionId,.classification,.sources);
    $observed[] as $item |
    ($expected | map(select(.key == $item.key)) | first) as $approved |
    select(($approved == null) or (($approved|core) != ($item|core)) or
      ([$approved.sources[]? | select(.endpoint == $endpoint and .region == $region and
        .bucket == $bucket and .pathStyle == $pathStyle)] | length != 1)) |
    {key:$item.key,reason:"source object or provenance differs from approved union"}' \
    >"$EXPECTED_SOURCE_CONFLICTS"
  [ ! -s "$EXPECTED_SOURCE_CONFLICTS" ] || \
    add_missing_proof 'current source disagrees with the approved union'
fi

copy_one() {
  local item="$1" result="$2" index="$3" mode="${4:-missing}" key body getout putout sha
  local content_type content_encoding cache_control disposition metadata tagging
  local args
  key="$(jq -r '.key' <<<"$item")"; body="$WORK_DIR/copy-body-$index"
  getout="$WORK_DIR/copy-get-$index.json"; putout="$WORK_DIR/copy-put-$index.json"
  if ! retry_get_object "$getout" "$body" source "$SOURCE_BUCKET" "$key"; then
    jq -cn --arg key "$key" '{status:"failed",key:$key,operation:"get-object"}' >"$result"
    return 1
  fi
  sha="$(sha256sum "$body" | awk '{print $1}')"
  if [ "$sha" != "$(jq -r '.sha256' <<<"$item")" ]; then
    rm -f "$body"
    jq -cn --arg key "$key" '{status:"failed",key:$key,operation:"source-changed"}' >"$result"
    return 1
  fi
  args=(put-object --bucket "$DESTINATION_BUCKET" --key "$key" --body "$body")
  if [ "$mode" = missing ]; then
    args+=(--if-none-match '*')
  else
    args+=(--if-match "$(jq -r '._priorEtag' <<<"$item")")
  fi
  content_type="$(jq -r '.contentType // empty' <<<"$item")"
  content_encoding="$(jq -r '.contentEncoding // empty' <<<"$item")"
  cache_control="$(jq -r '.cacheControl // empty' <<<"$item")"
  disposition="$(jq -r '.contentDisposition // empty' <<<"$item")"
  metadata="$(jq -c '.metadata' <<<"$item")"
  tagging="$(jq -r '[.tags[]? | ((.Key|@uri) + "=" + (.Value|@uri))] | join("&")' <<<"$item")"
  [ -z "$content_type" ] || args+=(--content-type "$content_type")
  [ -z "$content_encoding" ] || args+=(--content-encoding "$content_encoding")
  [ -z "$cache_control" ] || args+=(--cache-control "$cache_control")
  [ -z "$disposition" ] || args+=(--content-disposition "$disposition")
  [ "$metadata" = '{}' ] || args+=(--metadata "$metadata")
  [ -z "$tagging" ] || args+=(--tagging "$tagging")
  if ! retry_json "$putout" destination "${args[@]}"; then
    rm -f "$body"
    jq -cn --arg key "$key" '{status:"failed",key:$key,operation:"conditional-put"}' >"$result"
    return 1
  fi
  rm -f "$body"
  jq -cn --arg key "$key" --arg mode "$mode" \
    --arg versionId "$(jq -r '.VersionId // empty' "$putout")" \
    --arg priorVersionId "$(jq -r '._priorVersionId // empty' <<<"$item")" \
    --arg priorHash "$(jq -r '._priorHash // empty' <<<"$item")" '
    {status:(if $mode == "missing" then "copied" else "reconciled" end),key:$key,
     putVersionId:(if $versionId == "" then null else $versionId end),
     priorVersionId:(if $priorVersionId == "" then null else $priorVersionId end),
     priorHash:(if $priorHash == "" then null else $priorHash end)}' \
    >"$result"
}

run_copy_tasks() {
  local tasks="$1" result_dir="$2" mode="$3" output="$4" index=0 item result failed
  local -a pids=() results=()
  mkdir -p "$result_dir"
  while IFS= read -r item; do
    index=$((index + 1)); result="$result_dir/$index.json"
    copy_one "$item" "$result" "$index" "$mode" & pids+=("$!"); results+=("$result")
    if [ "${#pids[@]}" -ge "$CONCURRENCY" ]; then
      for pid in "${pids[@]}"; do wait "$pid" || true; done
      failed=false
      for result in "${results[@]}"; do
        if [ "$(jq -r '.status' "$result")" = failed ]; then
          record_failure destination "$(jq -r '.key' "$result")" "$(jq -r '.operation' "$result")"
          failed=true
        fi
      done
      pids=(); results=()
      failure_cap_reached && break
      $failed && [ "$FAILURE_COUNT" -ge "$MAX_FAILURES" ] && break
    fi
  done <"$tasks"
  for pid in "${pids[@]}"; do wait "$pid" || true; done
  for result in "${results[@]}"; do
    if [ "$(jq -r '.status' "$result")" = failed ]; then
      record_failure destination "$(jq -r '.key' "$result")" "$(jq -r '.operation' "$result")"
    fi
  done
  local -a files=("$result_dir"/*.json)
  if [ -e "${files[0]}" ]; then
    jq -cs 'map(select(.status != "failed")) | sort_by(.key)[]' "${files[@]}" >"$output"
  else
    : >"$output"
  fi
}

copy_missing_objects() {
  local tasks="$WORK_DIR/copy-tasks.jsonl"
  jq -c --slurpfile source "$REPORT_DIR/source-included-manifest.jsonl" '
    .missing[] as $key | ($source | map(select(.key == $key)) | first) |
    select(. != null)' "$PARITY" >"$tasks"
  run_copy_tasks "$tasks" "$WORK_DIR/copy-results" missing "$REPORT_DIR/copy-results.jsonl"
}

PARITY="$REPORT_DIR/parity.json"
compute_parity() {
  jq -n --slurpfile expected "$TARGET_MANIFEST" --slurpfile actual "$DESTINATION_MANIFEST" '
    def core: del(.etag,.versionId,.classification,.sources);
    def bykey($items;$key): $items | map(select(.key == $key)) | first;
    {missing:[$expected[] | select(bykey($actual;.key) == null) | .key],
     extra:[$actual[] | select(bykey($expected;.key) == null) | .key],
     conflicting:[$expected[] as $want | bykey($actual;$want.key) as $got |
       select($got != null and (($want|core) != ($got|core))) | $want.key],
     matching:[$expected[] as $want | bykey($actual;$want.key) as $got |
       select($got != null and (($want|core) == ($got|core))) | $want.key]}' >"$PARITY"
}
compute_parity

write_copy_ledger() {
  local ledger="$REPORT_DIR/copy-ledger.jsonl" run_id
  run_id="${MIGRATION_RUN_ID:-run-$(date -u +%Y%m%dT%H%M%SZ)}"
  jq -cn --slurpfile copied "$REPORT_DIR/copy-results.jsonl" \
    --slurpfile source "$REPORT_DIR/source-included-manifest.jsonl" \
    --slurpfile destination "$DESTINATION_MANIFEST" --arg runId "$run_id" \
    --arg se "$SOURCE_ENDPOINT" --arg sr "$SOURCE_REGION" --arg sb "$SOURCE_BUCKET" \
    --argjson sp "$SOURCE_PATH_STYLE" --arg de "$DESTINATION_ENDPOINT" \
    --arg dr "$DESTINATION_REGION" --arg db "$DESTINATION_BUCKET" \
    --argjson dp "$DESTINATION_PATH_STYLE" --arg expected "$EXPECTED_MANIFEST_DIGEST" \
    --arg environment "$ENVIRONMENT" --arg plane "$PLANE" '
    def core: del(.etag,.versionId,.classification,.sources);
    $copied[] as $copy |
    ($source | map(select(.key == $copy.key)) | first) as $sourceObject |
    ($destination | map(select(.key == $copy.key)) | first) as $object |
    select($object != null and (($object|core) == ($sourceObject|core))) |
    {schemaVersion:1,migrationId:$runId,environment:$environment,plane:$plane,
     source:{endpoint:$se,region:$sr,bucket:$sb,pathStyle:$sp},
     destination:{endpoint:$de,region:$dr,bucket:$db,pathStyle:$dp},
     key:$copy.key,sourceObject:$sourceObject,object:$object,
     putVersionId:$copy.putVersionId,
     expectedManifestDigest:(if $expected == "null" then null else $expected end)}' >"$ledger"
  if [ "$(jq -s length "$ledger")" != "$(jq -s length "$REPORT_DIR/copy-results.jsonl")" ]; then
    record_failure destination '' post-copy-ledger
    add_missing_proof 'not every copied object has re-read destination evidence'
  fi
}

if [ "$OPERATION" = copy ] && $EXECUTE_COPY && ! $RECONCILE_OWNED; then
  copy_missing_objects
  if list_objects destination "$DESTINATION_LISTING" &&
    build_manifest destination "$DESTINATION_LISTING" "$DESTINATION_MANIFEST"; then
    compute_parity
    write_copy_ledger
  else
    add_missing_proof 'post-copy destination evidence is incomplete'
  fi
fi

reconcile_owned_objects() {
  local versioning="$WORK_DIR/destination-versioning.json" tasks="$WORK_DIR/reconcile-tasks.jsonl"
  local original_digest conflict_count eligible_count output="$REPORT_DIR/reconciliation-results.jsonl"
  [ -r "$LEDGER" ] && [ -s "$LEDGER" ] || {
    add_missing_proof 'original ownership ledger is unreadable or empty'; return 1; }
  original_digest="$(sha256sum "$LEDGER" | awk '{print $1}')"
  jq -se --arg environment "$ENVIRONMENT" --arg plane "$PLANE" \
    --arg se "$SOURCE_ENDPOINT" --arg sr "$SOURCE_REGION" --arg sb "$SOURCE_BUCKET" \
    --argjson sp "$SOURCE_PATH_STYLE" --arg de "$DESTINATION_ENDPOINT" \
    --arg dr "$DESTINATION_REGION" --arg db "$DESTINATION_BUCKET" \
    --argjson dp "$DESTINATION_PATH_STYLE" '
    length > 0 and ([.[].key] | length == (unique | length)) and
    ([.[].migrationId] | unique | length == 1) and all(.[];
      .schemaVersion == 1 and .environment == $environment and .plane == $plane and
      .source == {endpoint:$se,region:$sr,bucket:$sb,pathStyle:$sp} and
      .destination == {endpoint:$de,region:$dr,bucket:$db,pathStyle:$dp} and
      .key == .object.key and .key == .sourceObject.key)' "$LEDGER" >/dev/null || {
    add_missing_proof 'ownership ledger schema, coordinates or keys do not match'; return 1; }
  retry_json "$versioning" destination get-bucket-versioning \
    --bucket "$DESTINATION_BUCKET" || {
    add_missing_proof 'destination versioning state is unavailable'; return 1; }
  [ "$(jq -r '.Status // empty' "$versioning")" = Enabled ] || {
    add_missing_proof 'destination versioning is not enabled'; return 1; }
  [ "$(jq '.missing | length + (.extra | length)' "$PARITY")" -eq 0 ] || {
    add_missing_proof 'owned reconciliation refuses missing or extra keys'; return 1; }
  conflict_count="$(jq '.conflicting | length' "$PARITY")"
  [ "$conflict_count" -gt 0 ] || {
    add_missing_proof 'owned reconciliation requires an observed conflict'; return 1; }
  jq -cn --slurpfile source "$REPORT_DIR/source-included-manifest.jsonl" \
    --slurpfile target "$TARGET_MANIFEST" --slurpfile destination "$DESTINATION_MANIFEST" \
    --slurpfile ledger "$LEDGER" --argfile parity "$PARITY" \
    --arg expected "$EXPECTED_MANIFEST_DIGEST" '
    def core: del(.etag,.versionId,.classification,.sources);
    $parity.conflicting[] as $key |
    ($source | map(select(.key == $key)) | first) as $sourceObject |
    ($target | map(select(.key == $key)) | first) as $targetObject |
    ($destination | map(select(.key == $key)) | first) as $current |
    ($ledger | map(select(.key == $key)) | first) as $owned |
    select($owned != null and $current != null and $sourceObject != null and
      ($sourceObject|core) == ($targetObject|core) and $owned.object == $current and
      $owned.putVersionId != null and $current.versionId == $owned.putVersionId and
      $owned.expectedManifestDigest == (if $expected == "null" then null else $expected end)) |
    $sourceObject + {_priorEtag:$current.etag,_priorVersionId:$current.versionId,
      _priorHash:$current.sha256}' >"$tasks"
  eligible_count="$(jq -s length "$tasks")"
  [ "$eligible_count" -eq "$conflict_count" ] || {
    add_missing_proof 'foreign or independently modified conflicts cannot be reconciled'; return 1; }
  run_copy_tasks "$tasks" "$WORK_DIR/reconciliation-results" reconcile "$output"
  list_objects destination "$DESTINATION_LISTING" &&
    build_manifest destination "$DESTINATION_LISTING" "$DESTINATION_MANIFEST" || {
    add_missing_proof 'post-reconciliation destination evidence is incomplete'; return 1; }
  compute_parity
  jq -cn --slurpfile results "$output" --slurpfile destination "$DESTINATION_MANIFEST" \
    --argfile first "$LEDGER" --arg ledgerDigest "$original_digest" \
    --arg fenceDigest "$FENCE_EVIDENCE_DIGEST" '
    $results[] as $result |
    ($destination | map(select(.key == $result.key)) | first) as $object |
    select($object != null and $result.putVersionId != null and
      $object.versionId == $result.putVersionId and
      $object.versionId != $result.priorVersionId and $object.sha256 != $result.priorHash) |
    {schemaVersion:1,migrationId:$first[0].migrationId,key:$result.key,
     originalLedgerDigest:$ledgerDigest,fenceEvidenceDigest:$fenceDigest,fenceValidated:false,
     prior:{versionId:$result.priorVersionId,sha256:$result.priorHash},
     new:{versionId:$object.versionId,sha256:$object.sha256},object:$object}' \
    >"$REPORT_DIR/reconciliation-ledger.jsonl"
  [ "$(jq -s length "$REPORT_DIR/reconciliation-ledger.jsonl")" -eq "$eligible_count" ] || {
    record_failure destination '' reconciliation-proof
    add_missing_proof 'reconciliation lacks recoverable prior/new version proof'; return 1; }
}

FENCE_EVIDENCE_DIGEST=null
if [ -n "$FENCE_RECORD" ]; then
  if [ -r "$FENCE_RECORD" ] && [ -s "$FENCE_RECORD" ]; then
    FENCE_EVIDENCE_DIGEST="$(sha256sum "$FENCE_RECORD" | awk '{print $1}')"
  else
    add_missing_proof 'fence record is unreadable or empty'
  fi
fi
if [ "$OPERATION" = copy ] && $EXECUTE_COPY && $RECONCILE_OWNED; then
  reconcile_owned_objects || true
fi

array_json() { printf '%s\n' "$@" | jq -Rsc 'split("\n") | map(select(length > 0))'; }
PREFIX_JSON="$(array_json "${PREFIXES[@]}")"
EXCLUDE_PREFIX_JSON="$(array_json "${EXCLUDE_PREFIXES[@]}")"
MISSING_PROOF_JSON="$(array_json "${MISSING_PROOF[@]}")"
count_lines() { jq -s 'length' "$1"; }
sum_bytes() { jq -s 'map(.size) | add // 0' "$1"; }
SOURCE_COUNT="$(count_lines "$SOURCE_MANIFEST")"
DESTINATION_COUNT="$(count_lines "$DESTINATION_MANIFEST")"
FAILURE_COUNT="$(count_lines "$REPORT_DIR/failures.jsonl")"
MISSING_COUNT="$(jq '.missing | length' "$PARITY")"
EXTRA_COUNT="$(jq '.extra | length' "$PARITY")"
CONFLICT_COUNT="$(jq '.conflicting | length' "$PARITY")"
EXPECTED_SOURCE_CONFLICT_COUNT="$(count_lines "$EXPECTED_SOURCE_CONFLICTS")"
CUTOVER_READY=false
if [ "$OPERATION" = delta ] && [ "$FAILURE_COUNT" -eq 0 ] &&
  [ "$(jq 'length' <<<"$MISSING_PROOF_JSON")" -eq 0 ] &&
  [ "$MISSING_COUNT" -eq 0 ] && [ "$EXTRA_COUNT" -eq 0 ] &&
  [ "$CONFLICT_COUNT" -eq 0 ] && [ "$EXPECTED_SOURCE_CONFLICT_COUNT" -eq 0 ]; then
  CUTOVER_READY=true
fi

jq -n --arg operation "$OPERATION" --arg environment "$ENVIRONMENT" --arg plane "$PLANE" \
  --arg se "$SOURCE_ENDPOINT" --arg sr "$SOURCE_REGION" --arg sb "$SOURCE_BUCKET" \
  --argjson sp "$SOURCE_PATH_STYLE" --arg sf "$SOURCE_IDENTITY_FINGERPRINT" \
  --arg de "$DESTINATION_ENDPOINT" --arg dr "$DESTINATION_REGION" \
  --arg db "$DESTINATION_BUCKET" --argjson dp "$DESTINATION_PATH_STYLE" \
  --arg df "$DESTINATION_IDENTITY_FINGERPRINT" --argjson prefixes "$PREFIX_JSON" \
  --argjson exclusions "$EXCLUDE_PREFIX_JSON" --argjson missingProof "$MISSING_PROOF_JSON" \
  --arg expectedDigest "$EXPECTED_MANIFEST_DIGEST" --arg fenceDigest "$FENCE_EVIDENCE_DIGEST" \
  --argjson executeCopy "$EXECUTE_COPY" --argjson reconcileOwned "$RECONCILE_OWNED" \
  --argjson concurrency "$CONCURRENCY" --argjson retries "$RETRIES" \
  --argjson maxFailures "$MAX_FAILURES" --argjson maxObjectBytes "$MAX_OBJECT_BYTES" \
  --argjson sourceCount "$SOURCE_COUNT" --argjson destinationCount "$DESTINATION_COUNT" \
  --argjson sourceBytes "$(sum_bytes "$SOURCE_MANIFEST")" \
  --argjson destinationBytes "$(sum_bytes "$DESTINATION_MANIFEST")" \
  --argjson failures "$FAILURE_COUNT" --argjson expectedSourceConflicts "$EXPECTED_SOURCE_CONFLICT_COUNT" \
  --argjson parity "$(cat "$PARITY")" --argjson cutoverReady "$CUTOVER_READY" '
  {operation:$operation,environment:$environment,plane:$plane,executeCopy:$executeCopy,
   reconcileOwned:$reconcileOwned,
   source:{endpoint:$se,region:$sr,bucket:$sb,pathStyle:$sp,identityFingerprint:$sf},
   destination:{endpoint:$de,region:$dr,bucket:$db,pathStyle:$dp,identityFingerprint:$df},
   prefixes:$prefixes,excludePrefixes:$exclusions,
   limits:{concurrency:$concurrency,retries:$retries,maxFailures:$maxFailures,
     maxObjectBytes:$maxObjectBytes},
   counts:{source:$sourceCount,destination:$destinationCount,missing:($parity.missing|length),
     extra:($parity.extra|length),conflicting:($parity.conflicting|length),
     matching:($parity.matching|length),failures:$failures,
     expectedSourceConflicts:$expectedSourceConflicts},
   bytes:{source:$sourceBytes,destination:$destinationBytes},objects:$parity,
   missingProof:$missingProof,expectedManifestDigest:
     (if $expectedDigest == "null" then null else $expectedDigest end),
   fenceEvidenceDigest:(if $fenceDigest == "null" then null else $fenceDigest end),
   fenceValidated:false,cutoverReady:$cutoverReady}' >"$REPORT_DIR/summary.json"

STATUS=0
[ "$FAILURE_COUNT" -eq 0 ] && [ "$(jq 'length' <<<"$MISSING_PROOF_JSON")" -eq 0 ] || STATUS=1
[ "$EXTRA_COUNT" -eq 0 ] && [ "$CONFLICT_COUNT" -eq 0 ] &&
  [ "$EXPECTED_SOURCE_CONFLICT_COUNT" -eq 0 ] || STATUS=1
case "$OPERATION" in
  verify|delta) [ "$MISSING_COUNT" -eq 0 ] || STATUS=1 ;;
  copy) $EXECUTE_COPY && [ "$MISSING_COUNT" -ne 0 ] && STATUS=1 ;;
esac
exit "$STATUS"
