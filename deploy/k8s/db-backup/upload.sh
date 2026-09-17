#!/bin/sh
set -eu
: "${POSTGRES_DB:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_ENV:?}"
now="$(cat /work/created-at)"
dump="/work/radar-${now}.dump"
sha="${dump}.sha256"
manifest="/work/radar-${now}.manifest.json"
printf '{"schemaVersion":1,"database":"%s","postgresMajor":16,"createdAt":"%s","sha256":"%s"}\n' \
  "$POSTGRES_DB" "$now" "$(cut -d ' ' -f 1 "$sha")" > "$manifest"
upload() {
  class="$1" target="s3://${BACKUP_S3_BUCKET}/postgres/${BACKUP_ENV}/${class}/radar-${now}"
  aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$dump" "${target}.dump" --sse AES256
  aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$sha" "${target}.dump.sha256" --sse AES256
  aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$manifest" "${target}.manifest.json" --sse AES256
}
upload daily
[ "$(date -u +%u)" = 7 ] && upload weekly || :
[ "$(date -u +%d)" = 01 ] && upload monthly || :
