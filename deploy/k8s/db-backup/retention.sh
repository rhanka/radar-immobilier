#!/bin/sh
# Retain newest complete backup sets per cadence. Object keys use UTC ISO order.
set -eu
: "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_ENV:?}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"

retain() {
  class="$1" keep="$2"
  case "$keep" in ''|*[!0-9]*) echo "retention for ${class} must be numeric" >&2; exit 2;; esac
  prefix="postgres/${BACKUP_ENV}/${class}/"
  # Select manifests only: deleting their matching three-object set prevents an
  # incomplete dump from being presented as a restore candidate. No awk {n}
  # intervals: busybox/mawk portability is required.
  keys="$(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 ls "s3://${BACKUP_S3_BUCKET}/${prefix}" --recursive \
    | awk 'NF >= 4 && $4 ~ /\.manifest\.json$/ {print $4}' | LC_ALL=C sort)"
  total="$(printf '%s\n' "$keys" | grep -c . || true)"
  [ "$total" -le "$keep" ] && return 0
  drop=$((total - keep))
  printf '%s\n' "$keys" | head -n "$drop" | while IFS= read -r manifest; do
    stem="${manifest%.manifest.json}"
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 rm "s3://${BACKUP_S3_BUCKET}/${stem}.dump"
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 rm "s3://${BACKUP_S3_BUCKET}/${stem}.dump.sha256"
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 rm "s3://${BACKUP_S3_BUCKET}/${manifest}"
  done
}
retain daily "${BACKUP_RETAIN_DAILY:-7}"
retain weekly "${BACKUP_RETAIN_WEEKLY:-4}"
retain monthly "${BACKUP_RETAIN_MONTHLY:-1}"
