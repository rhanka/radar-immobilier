#!/usr/bin/env bash
# Download and integrity-check one city's exact manifest entries.
# Usage: download-cas-corpus.sh <city> <manifest.tsv> <work_dir>
set -euo pipefail

CITY="${1:?city required}"
MANIFEST="${2:?manifest required}"
WORK_DIR="${3:?work directory required}"
LOG="$WORK_DIR/worker.log"
CITY_MANIFEST="$WORK_DIR/cas-manifest.tsv"

mkdir -p "$WORK_DIR/corpus" "$WORK_DIR/parsed/$CITY"
awk -F '\t' -v city="$CITY" 'NR == 1 || $2 == city' "$MANIFEST" > "$CITY_MANIFEST"
expected=$(awk 'END {print NR-1}' "$CITY_MANIFEST")
verified=0

while IFS=$'\t' read -r source_id city sha primary_key sidecar_key; do
  [ "$source_id" = "source_id" ] && continue
  primary="$WORK_DIR/corpus/$(basename "$primary_key")"
  s5cmd --endpoint-url "$SCRAPE_S3_ENDPOINT" \
    cp "s3://$SCRAPE_S3_BUCKET/$primary_key" "$primary" >> "$LOG" 2>&1
  if [ "$sidecar_key" != "source-gap" ]; then
    sidecar="$WORK_DIR/corpus/$(basename "$sidecar_key")"
    s5cmd --endpoint-url "$SCRAPE_S3_ENDPOINT" \
      cp "s3://$SCRAPE_S3_BUCKET/$sidecar_key" "$sidecar" >> "$LOG" 2>&1
    [ -s "$sidecar" ] || { echo "[download] $CITY: sidecar_missing_$sha" >&2; exit 1; }
  fi
  actual_sha=$(sha256sum "$primary" | awk '{print $1}')
  [ "$actual_sha" = "$sha" ] || { echo "[download] $CITY: cas_integrity_failed_$sha" >&2; exit 1; }
  if [ "${primary##*.}" = "pdf" ]; then
    parsed_pdf="$WORK_DIR/parsed/$CITY/$sha.txt"
    pdftotext -layout "$primary" "$parsed_pdf" 2>> "$LOG" || {
      echo "[download] $CITY: pdf_text_conversion_failed_$sha" >&2
      exit 1
    }
    grep -q '[[:alnum:]]' "$parsed_pdf" || {
      echo "[download] $CITY: pdf_text_unavailable_$sha" >&2
      exit 1
    }
  fi
  verified=$((verified + 1))
done < "$CITY_MANIFEST"

[ "$verified" -eq "$expected" ] || {
  echo "[download] $CITY: cas_download_count_${verified}_of_${expected}" >&2
  exit 1
}
printf '%s\n' "$verified"
