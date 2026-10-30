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
  export BR_SCRIPT BR_STEP=$step JOB_NAME=cutover-placeholder BACKUP_ID=${BACKUP_ID:-latest} ALLOW_STALE_BACKUP=false MAX_AGE_HOURS=24 S3_FORCE_PATH_STYLE=true
  export BACKUP_DATE PIN_MANIFEST_SHA256 PIN_PG_SHA256 EXPECTED_DATABASE RESTORE_ASSERT_DB=1
  BACKUP_DATE=$(jq -r '.pin.date//""' "$WORK/record.json")
  PIN_MANIFEST_SHA256=$(jq -r '.pin.manifestSha256//""' "$WORK/record.json")
  PIN_PG_SHA256=$(jq -r '.pin.pgSha256//""' "$WORK/record.json")
  EXPECTED_DATABASE=$(jq -r '.targetDb//.liveDb//"radar"' "$WORK/record.json")
  export TARGET_DB
  TARGET_DB=$(jq -r '.targetDb//""' "$WORK/record.json")
  export DST_BUCKET FORBIDDEN_DST_BUCKETS COPY_GRANTEE COPY_CONCURRENCY=${COPY_CONCURRENCY:-48} DOCS_DRY=0
  COPY_GRANTEE=$(jq -r .storage.copyGrantee "$CONFIG")
  DST_BUCKET=$(jq -r --arg e "$ENV" '.[$e].documents' "$CONFIG")
  FORBIDDEN_DST_BUCKETS="$(jq -r .prod.documents "$CONFIG"),$EXPECTED_BACKUP_BUCKET"
  case $step in
    resolve|list) template=deploy/ci/bascule-preprod/backup-read-job.tmpl.yaml;;
    docs|recon) template=deploy/ci/bascule-preprod/docs-restore-backup-job.tmpl.yaml;;
    restore) template=deploy/ci/bascule-preprod/db-restore-backup-job.tmpl.yaml;;
    backup)
      template=deploy/ci/db-backup-job.tmpl.yaml
      export UPLOAD_IMAGE=peakcom/s5cmd:v2.2.2 BACKUP_S3_ENDPOINT=$S3_ENDPOINT BACKUP_S3_REGION=$S3_REGION
      export BACKUP_S3_BUCKET=$EXPECTED_BACKUP_BUCKET S3_SECRET KEY="db-backups/cutover-$ENV-$RUN.sql.gz"
      S3_SECRET=$(jq -r .storage.backupSecret "$CONFIG");;
    ddl|destination|database|reset|discard) template=deploy/k8s/36-db-migrate-job.yaml;;
    data) template=deploy/cutover/data-migrate-job.tmpl.yaml;;
    refs)
      template=deploy/ci/bascule-preprod/served-refs-job.tmpl.yaml
      export REFS_CONFIGMAP_PREFIX=immo-served-refs REFS_CONFIGMAP_COUNT=4 REFS_WRITER_SA=radar-bascule-refs-writer;;
    *) fail 'Unknown fixed Job operation';;
  esac
  if [[ $step =~ ^(ddl|destination|database|reset|discard)$ ]]; then
    sed 's/^  namespace: radar-immobilier$/  namespace: ${NAMESPACE}/' "$template" > "$WORK/ddl-template.yaml"
    template=$WORK/ddl-template.yaml
  fi
  BR_SCRIPT=$(sed 's/^/              /' deploy/ci/bascule-preprod/backup-restore.cjs)
  if [[ $step == refs ]]; then BR_SCRIPT=$(sed 's/^/              /' deploy/ci/bascule-preprod/served-refs.cjs); fi
  # Only known placeholders; runtime libpq variables remain in the original script.
  envsubst '${JOB_NAME} ${NAMESPACE} ${IMAGE} ${DUMP_IMAGE} ${TTL_SECONDS} ${PGHOST} ${DB_SECRET} ${S3_ENDPOINT} ${S3_REGION} ${EXPECTED_BACKUP_BUCKET} ${READER_SECRET} ${COPY_SECRET} ${BR_STEP} ${BACKUP_ID} ${ALLOW_STALE_BACKUP} ${MAX_AGE_HOURS} ${S3_FORCE_PATH_STYLE} ${BACKUP_DATE} ${PIN_MANIFEST_SHA256} ${PIN_PG_SHA256} ${EXPECTED_DATABASE} ${RESTORE_ASSERT_DB} ${DST_BUCKET} ${FORBIDDEN_DST_BUCKETS} ${COPY_GRANTEE} ${COPY_CONCURRENCY} ${DOCS_DRY} ${BR_SCRIPT} ${UPLOAD_IMAGE} ${BACKUP_S3_ENDPOINT} ${BACKUP_S3_REGION} ${BACKUP_S3_BUCKET} ${S3_SECRET} ${KEY} ${CYCLE_ID} ${REFS_CONFIGMAP_PREFIX} ${REFS_CONFIGMAP_COUNT} ${REFS_WRITER_SA}' < "$template"
}
sanitize_job() {
  jq --rawfile wrapper deploy/cutover/job-wrapper.cjs --rawfile shellWrapper deploy/cutover/shell-wrapper.sh \
    --slurpfile r "$WORK/record.json" \
    --arg step "$step" --argjson timeout "$((deadline-20))" -f tools/make/cutover-sanitize.jq \
    "$WORK/job.json" > "$WORK/sanitized.json"
  mv "$WORK/sanitized.json" "$WORK/job.json"
}
