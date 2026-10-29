#!/usr/bin/env bash
render_template() {
  local step=$1 template
  if [[ $step == refresh ]]; then
    "${k[@]}" create job cutover-refresh --from=cronjob/radar-refresh-pv --dry-run=client -o yaml
    return
  fi
  export NAMESPACE=$NS IMAGE DUMP_IMAGE=postgis/postgis:16-3.4 TTL_SECONDS=86400
  IMAGE=$(jq -r .release.apiImage "$WORK/record.json")
  export PGHOST=radar-postgres DB_SECRET S3_ENDPOINT S3_REGION EXPECTED_BACKUP_BUCKET READER_SECRET COPY_SECRET
  DB_SECRET=$(jq -r .storage.dbSecret "$CONFIG")
  S3_ENDPOINT=$(jq -r .storage.endpoint "$CONFIG"); S3_REGION=$(jq -r .storage.region "$CONFIG")
  EXPECTED_BACKUP_BUCKET=$(jq -r .storage.backupBucket "$CONFIG")
  READER_SECRET=$(jq -r .storage.readerSecret "$CONFIG"); COPY_SECRET=$(jq -r .storage.copySecret "$CONFIG")
