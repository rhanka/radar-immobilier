#!/usr/bin/env bash
# Build or validate an immutable CAS manifest for graphify v2.3.
# Usage: build-cas-manifest.sh <targets.tsv> <output.tsv> <since_utc> [input.tsv]
set -euo pipefail

TARGETS="${1:?targets TSV required}"
OUTPUT="${2:?output TSV required}"
SINCE="${3:?UTC discovery boundary required}"
INPUT="${4:-}"

S3_URL="${SCRAPE_S3_ENDPOINT:-}"
BUCKET="${SCRAPE_S3_BUCKET:-}"
if [ -z "$S3_URL" ] || [ -z "$BUCKET" ]; then
  echo "[manifest] S3 configuration missing" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
tmp="${OUTPUT}.tmp.$$"
trap 'rm -f "$tmp"' EXIT

validate_manifest() {
  local manifest="$1"
  awk -F '\t' '
    NR == 1 {
      if ($0 != "source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key") exit 2
      next
    }
    NF != 5 || $3 !~ /^[0-9a-f]{64}$/ { exit 3 }
    $4 !~ ("^raw/" $1 "/cas/" $3 "\\.(txt|html|pdf)$") { exit 4 }
    $5 != "source-gap" && $5 !~ ("^raw/" $1 "/cas/" $3 "\\.(html|pdf)\\.meta\\.json$") { exit 5 }
    { key=$1 SUBSEP $2 SUBSEP $3; if (seen[key]++) exit 6 }
  ' "$manifest" || {
    echo "[manifest] invalid immutable manifest: $manifest" >&2
    exit 1
  }

  local expected_total=0 actual_total
  actual_total=$(awk 'END {print NR-1}' "$manifest")
  while IFS=$'\t' read -r source_id city expected; do
    [ "$source_id" = "source_id" ] && continue
    local actual
    actual=$(awk -F '\t' -v source="$source_id" -v slug="$city" \
      'NR > 1 && $1 == source && $2 == slug {count++} END {print count+0}' "$manifest")
    if [ "$actual" -ne "$expected" ]; then
      echo "[manifest] $city: expected $expected documents, found $actual" >&2
      exit 1
    fi
    expected_total=$((expected_total + expected))
  done < "$TARGETS"
  if [ "$actual_total" -ne "$expected_total" ]; then
    echo "[manifest] total mismatch: expected $expected_total, found $actual_total" >&2
    exit 1
  fi
}

if [ -n "$INPUT" ]; then
  validate_manifest "$INPUT"
  if [ "$INPUT" != "$OUTPUT" ]; then
    cp "$INPUT" "$tmp"
    mv "$tmp" "$OUTPUT"
  fi
else
  printf 'source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key\n' > "$tmp"
  while IFS=$'\t' read -r source_id city expected; do
    [ "$source_id" = "source_id" ] && continue
    listing="${OUTPUT}.${city}.listing.$$"
    if ! s5cmd --json --endpoint-url "$S3_URL" \
      ls "s3://$BUCKET/raw/$source_id/cas/*" > "$listing"; then
      echo "[manifest] $city: CAS listing failed" >&2
      rm -f "$listing"
      exit 1
    fi
    jq -sr --arg since "$SINCE" --arg bucket "s3://$BUCKET/" \
      --arg source "$source_id" --arg city "$city" '
      [.[]
        | select(.type == "file")
        | . + (.key | capture("/(?<sha>[0-9a-f]{64})\\.(?<suffix>pdf|html|txt)(?<meta>\\.meta\\.json)?$")?)]
      | map(select(.sha != null))
      | group_by(.sha)[]
      | . as $rows
      | select(any($rows[]; .last_modified >= $since))
      | ($rows[0].sha) as $sha
      | ([ $rows[] | select(.meta == null and .suffix == "txt") ][0]
         // [ $rows[] | select(.meta == null and .suffix == "html") ][0]
         // [ $rows[] | select(.meta == null and .suffix == "pdf") ][0]) as $primary
      | ([ $rows[] | select(.meta != null and .suffix == "html") ][0]
         // [ $rows[] | select(.meta != null and .suffix == "pdf") ][0]) as $sidecar
      | select($primary != null)
      | [$source, $city, $sha,
         ($primary.key | sub("^" + $bucket; "")),
         (if $sidecar == null then "source-gap" else ($sidecar.key | sub("^" + $bucket; "")) end)]
      | @tsv
    ' "$listing" -r | sort >> "$tmp"
    rm -f "$listing"
    actual=$(awk -F '\t' -v slug="$city" '$2 == slug {count++} END {print count+0}' "$tmp")
    if [ "$actual" -ne "$expected" ]; then
      echo "[manifest] $city: expected $expected documents, discovered $actual" >&2
      exit 1
    fi
  done < "$TARGETS"
  mv "$tmp" "$OUTPUT"
  validate_manifest "$OUTPUT"
fi

sha256sum "$OUTPUT" > "${OUTPUT}.sha256"
count=$(awk 'END {print NR-1}' "$OUTPUT")
source_gaps=$(awk -F '\t' '$5 == "source-gap" {count++} END {print count+0}' "$OUTPUT")
echo "[manifest] immutable CAS manifest ready: $count documents, $source_gaps metadata source gaps"
