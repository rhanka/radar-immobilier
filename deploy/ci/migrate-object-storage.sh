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
