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
  if jq -e '.kind=="prepare" or .mode=="run"' "$WORK/record.json" >/dev/null; then MAX_AGE_HOURS=26; fi
  export BACKUP_DATE PIN_MANIFEST_SHA256 PIN_PG_SHA256 EXPECTED_DATABASE RESTORE_ASSERT_DB=1
  BACKUP_DATE=$(jq -r '.pin.date//""' "$WORK/record.json")
  PIN_MANIFEST_SHA256=$(jq -r '.pin.manifestSha256//""' "$WORK/record.json")
  PIN_PG_SHA256=$(jq -r '.pin.pgSha256//""' "$WORK/record.json")
  EXPECTED_DATABASE=$(jq -r '.targetDb//.liveDb//"radar"' "$WORK/record.json")
  # A staged template restore targets the template database (fixed name in config.json).
  [[ $step != restore ]] || EXPECTED_DATABASE=$(jq -r '.restoreDb//.targetDb//.liveDb//"radar"' "$WORK/record.json")
  export TARGET_DB
  TARGET_DB=$(jq -r '.targetDb//""' "$WORK/record.json")
  if [[ $step =~ ^tpl ]]; then TARGET_DB=$(jq -r .preprod.templateDb "$CONFIG"); fi
  if [[ $step =~ ^(freeze|unfreeze|unfreezeprev)$ ]]; then TARGET_DB=$(jq -r '.freezeDb//.liveDb' "$WORK/record.json"); fi
  if [[ $step == probecount ]]; then TARGET_DB=$(jq -r '.probeDb' "$WORK/record.json"); fi
  # Recovery backups go to the per-environment bucket that the namespace backup Secret can write.
  export RECOVERY_BUCKET
  RECOVERY_BUCKET=$(jq -er --arg e "$ENV" '.[$e].recoveryBucket|select(test("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"))' "$CONFIG") || fail 'Missing recovery backup bucket'
  export DST_BUCKET FORBIDDEN_DST_BUCKETS COPY_GRANTEE COPY_CONCURRENCY=${COPY_CONCURRENCY:-48} DOCS_DRY=0
  COPY_GRANTEE=$(jq -r .storage.copyGrantee "$CONFIG")
  DST_BUCKET=$(jq -r --arg e "$ENV" '.[$e].documents' "$CONFIG")
  FORBIDDEN_DST_BUCKETS="$(jq -r .prod.documents "$CONFIG"),$EXPECTED_BACKUP_BUCKET"
  [[ $RECOVERY_BUCKET != "$DST_BUCKET" && ,$FORBIDDEN_DST_BUCKETS, != *,$RECOVERY_BUCKET,* ]] || fail 'Recovery backup bucket overlaps a protected bucket'
  case $step in
    resolve|list) template=deploy/ci/bascule-preprod/backup-read-job.tmpl.yaml;;
    docs|recon) template=deploy/ci/bascule-preprod/docs-restore-backup-job.tmpl.yaml;;
    restore)
      template=deploy/ci/bascule-preprod/db-restore-backup-job.tmpl.yaml
      # Per-environment sizing that fits the namespace ResourceQuota; pg_restore keeps -j 4.
      export RESTORE_REQUEST_CPU RESTORE_REQUEST_MEMORY RESTORE_LIMIT_CPU RESTORE_LIMIT_MEMORY
      export RESTORE_JOBS=4 RESTORE_TUNED=0
      if [[ $EXPECTED_DATABASE == "$(jq -r .preprod.templateDb "$CONFIG")" ]]; then RESTORE_JOBS=2 RESTORE_TUNED=1; fi
      IFS=$'\t' read -r RESTORE_REQUEST_CPU RESTORE_REQUEST_MEMORY RESTORE_LIMIT_CPU RESTORE_LIMIT_MEMORY < <(jq -er --arg e "$ENV" '.[$e].restoreResources|[.requests.cpu,.requests.memory,.limits.cpu,.limits.memory]|select(all(type=="string" and test("^[0-9]+(m|Mi|Gi)?$")))|@tsv' "$CONFIG") || fail 'Missing restore Job resources';;
    backup)
      template=deploy/ci/db-backup-job.tmpl.yaml
      export UPLOAD_IMAGE=peakcom/s5cmd:v2.2.2 BACKUP_S3_ENDPOINT=$S3_ENDPOINT BACKUP_S3_REGION=$S3_REGION
      export BACKUP_S3_BUCKET=$RECOVERY_BUCKET S3_SECRET KEY="db-backups/cutover-$ENV-$RUN.sql.gz"
      S3_SECRET=$(jq -r .storage.backupSecret "$CONFIG");;
    probe)
      template=deploy/cutover/backup-probe-job.tmpl.yaml
      export UPLOAD_IMAGE=peakcom/s5cmd:v2.2.2 BACKUP_S3_ENDPOINT=$S3_ENDPOINT BACKUP_S3_REGION=$S3_REGION
      export BACKUP_S3_BUCKET=$RECOVERY_BUCKET S3_SECRET KEY="db-backups/cutover-$ENV-$RUN.probe"
      S3_SECRET=$(jq -r .storage.backupSecret "$CONFIG");;
    ddl|destination|database|identity|clone|discard|tplreset|tplseal|freeze|unfreeze|unfreezeprev|probeverify|probecount|volume[0-9]*|writestats[0-9]*) template=deploy/k8s/36-db-migrate-job.yaml;;
    data) template=deploy/cutover/data-migrate-job.tmpl.yaml;;
    logs*)
      template=deploy/cutover/logs-export-job.tmpl.yaml
      export BACKUP_S3_ENDPOINT=$S3_ENDPOINT BACKUP_S3_REGION=$S3_REGION BACKUP_S3_BUCKET=$RECOVERY_BUCKET S3_SECRET LOG_PODS LOG_PREFIX LOG_SCRIPT
      S3_SECRET=$(jq -r .storage.backupSecret "$CONFIG")
      LOG_PODS=$(jq -c --arg step "$step" '.logPods[$step]' "$WORK/record.json")
      LOG_PREFIX="cutover-logs/$ENV/$RUN/${step#logs}"
      LOG_SCRIPT=$(sed 's/^/              /' deploy/cutover/logs-export.cjs);;
    refs)
      template=deploy/ci/bascule-preprod/served-refs-job.tmpl.yaml
      export REFS_CONFIGMAP_PREFIX=immo-served-refs REFS_CONFIGMAP_COUNT=4 REFS_WRITER_SA=radar-bascule-refs-writer;;
    *) fail 'Unknown fixed Job operation';;
  esac
  if [[ $step =~ ^(ddl|destination|database|identity|clone|discard|tplreset|tplseal|freeze|unfreeze|unfreezeprev|probeverify|probecount|volume[0-9]*|writestats[0-9]*)$ ]]; then
    sed 's/^  namespace: radar-immobilier$/  namespace: ${NAMESPACE}/' "$template" > "$WORK/ddl-template.yaml"
    template=$WORK/ddl-template.yaml
  fi
  BR_SCRIPT=$(sed 's/^/              /' deploy/ci/bascule-preprod/backup-restore.cjs)
  export RESTORE_SCRIPT
  RESTORE_SCRIPT=$(sed 's/^/              /' deploy/cutover/atomic-restore.sh)
  if [[ $step == refs ]]; then BR_SCRIPT=$(sed 's/^/              /' deploy/ci/bascule-preprod/served-refs.cjs); fi
  # Only known placeholders; runtime libpq variables remain in the original script.
  envsubst '${JOB_NAME} ${NAMESPACE} ${IMAGE} ${DUMP_IMAGE} ${TTL_SECONDS} ${PGHOST} ${DB_SECRET} ${S3_ENDPOINT} ${S3_REGION} ${EXPECTED_BACKUP_BUCKET} ${READER_SECRET} ${COPY_SECRET} ${BR_STEP} ${BACKUP_ID} ${ALLOW_STALE_BACKUP} ${MAX_AGE_HOURS} ${S3_FORCE_PATH_STYLE} ${BACKUP_DATE} ${PIN_MANIFEST_SHA256} ${PIN_PG_SHA256} ${EXPECTED_DATABASE} ${RESTORE_ASSERT_DB} ${DST_BUCKET} ${FORBIDDEN_DST_BUCKETS} ${COPY_GRANTEE} ${COPY_CONCURRENCY} ${DOCS_DRY} ${BR_SCRIPT} ${RESTORE_SCRIPT} ${RESTORE_REQUEST_CPU} ${RESTORE_REQUEST_MEMORY} ${RESTORE_LIMIT_CPU} ${RESTORE_LIMIT_MEMORY} ${RESTORE_JOBS} ${RESTORE_TUNED} ${UPLOAD_IMAGE} ${BACKUP_S3_ENDPOINT} ${BACKUP_S3_REGION} ${BACKUP_S3_BUCKET} ${S3_SECRET} ${KEY} ${CYCLE_ID} ${LOG_PODS} ${LOG_PREFIX} ${LOG_SCRIPT} ${REFS_CONFIGMAP_PREFIX} ${REFS_CONFIGMAP_COUNT} ${REFS_WRITER_SA}' < "$template"
}
sanitize_job() {
  jq --rawfile wrapper deploy/cutover/job-wrapper.cjs --rawfile shellWrapper deploy/cutover/shell-wrapper.sh \
    --slurpfile r "$WORK/record.json" \
    --arg step "$step" --argjson timeout "$((deadline-20))" -f tools/make/cutover-sanitize.jq \
    "$WORK/job.json" > "$WORK/sanitized.json"
  mv "$WORK/sanitized.json" "$WORK/job.json"
}
# Prepared slot: one Deployment and one internal Service per canonical component, plus
# the UI nginx ConfigMap re-pointed at radar-api-prepared. Same component labels (the
# NetworkPolicies apply), `sentropic.io/slot=prepared`, literal POSTGRES_DB, release images,
# replicas equal to the current canonical count (HPA-scaled count included).
PREPARED_NAMES=(radar-api radar-immo-mcp radar-ui)
prepared_config_sha() {
  # Fingerprint of the configuration the prepared Pods read at start: a later ConfigMap change
  # (deploy reconcile) makes the slot stale and it is restarted before any switch.
  local cm
  for cm in radar-api immo-mcp-config radar-ui-nginx; do
    "${k[@]}" get configmap "$cm" --ignore-not-found -o json | jq -cS '.data//{}'
  done | sha256sum | cut -c1-16
}
render_prepared_stack() {
  local db=$1 name cfg
  cfg=$(prepared_config_sha)
  : > "$WORK/prepared-stack.jsonl"
  "${k[@]}" get configmap radar-ui-nginx -o json | jq -c --arg ns "$NS" '{apiVersion:"v1",kind:"ConfigMap",
    metadata:{name:"radar-ui-nginx-prepared",namespace:$ns,labels:(.metadata.labels//{}|.["sentropic.io/slot"]="prepared")},
    data:(.data|map_values(gsub("http://radar-api:3000";"http://radar-api-prepared:3000")))}' >> "$WORK/prepared-stack.jsonl"
  for name in "${PREPARED_NAMES[@]}"; do
    # Workload spec from the release manifests (#611: env, secretKeyRef, probes, resources reach
    # preprod); only the replica count comes from the running canonical Deployment.
    release_object Deployment "$name" > "$WORK/release-deployment.json"
    "${k[@]}" get deployment "$name" -o json > "$WORK/canonical-deployment.json"
    "${k[@]}" get service "$name" -o json > "$WORK/canonical-service.json"
    jq -c --slurpfile r "$WORK/record.json" --arg ns "$NS" --arg db "$db" --arg l "$SLOT_LABEL" --arg cfg "$cfg" \
      --argjson replicas "$(jq '.spec.replicas//1' "$WORK/canonical-deployment.json")" '
      def images: if (.image|test("^ghcr.io/rhanka/radar-api[:@]")) then .image=$r[0].release.apiImage
        elif (.image|test("^ghcr.io/rhanka/radar-ui[:@]")) then .image=$r[0].release.uiImage else . end;
      .metadata.name as $name|
      {apiVersion:"apps/v1",kind:"Deployment",
       metadata:{name:($name+"-prepared"),namespace:$ns,labels:(.metadata.labels//{}|.[$l]="prepared"),
         annotations:{"sentropic.io/prepared-run":$r[0].run,"sentropic.io/prepared-db":$db,"sentropic.io/prepared-config":$cfg}},
       spec:{replicas:$replicas,strategy:.spec.strategy,
         selector:{matchLabels:(.spec.selector.matchLabels|.[$l]="prepared")},
         template:(.spec.template|.metadata.labels=((.metadata.labels//{})|.[$l]="prepared"|del(.["pod-template-hash"]))|
           .metadata.annotations=((.metadata.annotations//{})|.["sentropic.io/prepared-run"]=$r[0].run)|
           .spec.terminationGracePeriodSeconds=(.spec.terminationGracePeriodSeconds//30)|
           (.spec.containers[],.spec.initContainers[]?) |= (images|
             if $name=="radar-ui" then . else
               .env=((.env//[])|map(select(.name!="POSTGRES_DB" and .name!="RADAR_API_BASE_URL"))
                 +[{name:"POSTGRES_DB",value:$db}]
                 +(if $name=="radar-immo-mcp" then [{name:"RADAR_API_BASE_URL",value:"http://radar-api-prepared:3000"}] else [] end))
             end)|
           .spec.volumes=((.spec.volumes//[])|map(if .configMap.name=="radar-ui-nginx"
             then .configMap.name="radar-ui-nginx-prepared" else . end)))}}' \
      "$WORK/release-deployment.json" >> "$WORK/prepared-stack.jsonl"
    jq -c --arg ns "$NS" --arg l "$SLOT_LABEL" '{apiVersion:"v1",kind:"Service",
      metadata:{name:(.metadata.name+"-prepared"),namespace:$ns,labels:(.metadata.labels//{}|.[$l]="prepared")},
      spec:{type:"ClusterIP",ports:.spec.ports,selector:(.spec.selector|.[$l]="prepared")}}' \
      "$WORK/canonical-service.json" >> "$WORK/prepared-stack.jsonl"
  done
}
# Release manifests (#611): the workloads of the delivered commit, rendered with kustomize from the
# `manifests` directories of config.json. The prepared slot is built from them and the promotion
# applies them to the canonical slot, so a manifest change (env, secretKeyRef, probes, resources,
# grace period) reaches the environment through the cutover. The checkout must be that commit.
release_manifests() {
  [[ -s $WORK/release-manifests.json ]] && return 0
  local sha dir
  sha=$(git rev-parse HEAD 2>/dev/null || true)
  [[ -z $sha || $sha == "$(jq -r .release.gitSha "$WORK/record.json")" ]] ||
    fail "release_manifests_mismatch: checkout $sha is not the release commit; check out the release before the cutover"
  : > "$WORK/release-manifests.yaml"
  while read -r dir; do
    "${k[@]}" kustomize --load-restrictor LoadRestrictionsNone "$dir" >> "$WORK/release-manifests.yaml" ||
      fail "Release manifests not renderable: $dir"
    printf '\n---\n' >> "$WORK/release-manifests.yaml"
  done < <(jq -r --arg e "$ENV" '.[$e].manifests[]' "$CONFIG")
  "${k[@]}" create --dry-run=client -f "$WORK/release-manifests.yaml" -o json |
    jq -c '[if .kind=="List" then .items[] else . end]' > "$WORK/release-manifests.json" || fail 'Release manifests unreadable'
}
release_find() {
  # release_find <kind> <name>: the release object, or null. A rollback carries the specs that
  # ran before the promotion it reverts (.releaseSpecs), not a rendering of another commit.
  if jq -e '.releaseSpecs!=null' "$WORK/record.json" >/dev/null; then
    jq -c --arg key "$1/$2" '.releaseSpecs[$key]' "$WORK/record.json"
    return
  fi
  release_manifests
  jq -c --arg kind "$1" --arg name "$2" '[.[]|select(.kind==$kind and .metadata.name==$name)]|first' "$WORK/release-manifests.json"
}
release_object() {
  # release_object <kind> <name>: the release object, or a refusal.
  local object
  object=$(release_find "$1" "$2")
  [[ $object != null && -n $object ]] || fail "release_manifest_missing: $1/$2"
  printf '%s\n' "$object"
}
