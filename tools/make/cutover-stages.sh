#!/usr/bin/env bash
save_release() {
  jq --slurpfile release "$1" '.release=$release[0]' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
deployed_release() {
  "${k[@]}" get pods -o json > "$WORK/deployed-pods.json"
  local api ui sha short
  api=$(jq -er '[.items[]|select(.metadata.labels["app.kubernetes.io/component"]=="api")|
    .status.containerStatuses[]?|select(.name=="api" and .ready)|.imageID|sub("^docker-pullable://";"")]|unique|select(length==1)|first' "$WORK/deployed-pods.json")
  ui=$(jq -er '[.items[]|select(.metadata.labels["app.kubernetes.io/component"]=="ui")|
    .status.containerStatuses[]?|select(.name=="ui" and .ready)|.imageID|sub("^docker-pullable://";"")]|unique|select(length==1)|first' "$WORK/deployed-pods.json")
  curl -q -fsS --max-time 15 "$URL/health" -o "$WORK/health.json" 2>/dev/null || fail 'Cannot identify deployed API'
  curl -q -fsS --max-time 15 "$URL/build.json" -o "$WORK/build.json" 2>/dev/null || fail 'Cannot identify deployed UI'
  sha=$(jq -er .sha "$WORK/health.json"); short=$(jq -er .sha "$WORK/build.json")
  jq -n --arg api "$api" --arg ui "$ui" --arg sha "$sha" --arg short "$short" \
    '{version:1,gitSha:$sha,apiImage:$api,uiImage:$ui,apiServedSha:$sha,uiServedSha:$short,dataMigration:null}' > "$WORK/release.json"
  validate_release "$WORK/release.json"; save_release "$WORK/release.json"
}
restore_stage() {
  # Fail before any closure when the recovery backup bucket is not writable.
  run_job probe 170 180
  if jq -e '.checkpoints.close!=null' "$WORK/record.json" >/dev/null; then close_once; fi
  run_job destination 60 90
  [[ $ENV == preprod ]] || return 0
  if [[ $(jq -r '.checkpoints.restore//""' "$WORK/record.json") == completed ]]; then return; fi
  run_job resolve 540 600
  jq -e '.ok==true and (.date|test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
    and (.pgSha256|test("^[a-f0-9]{64}$")) and (.manifestSha256|test("^[a-f0-9]{64}$"))
    and .pgSizeBytes>0' "$WORK/verdict.json" >/dev/null || fail 'Invalid backup pin'
  jq --slurpfile pin "$WORK/verdict.json" '.pin=$pin[0]' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  # Additive documents are prepared while services are still available (addendum 9).
  run_job docs 7200 7500
  run_job recon 840 900
  if [[ $(jq -r '.checkpoints.repoint//""' "$WORK/record.json") != completed ]]; then
    checkpoint repoint started
    "${k[@]}" patch configmap radar-api --type=merge -p '{"data":{"GEO_DOCUMENTS_REPOINT":null}}' >/dev/null
    checkpoint repoint completed
  fi
  close_once
  run_job restore 3600 3900
}
migrate_stage() {
  run_job backup 840 900
  jq --arg ref "s3://$(jq -r --arg e "$ENV" '.[$e].recoveryBucket' "$CONFIG")/db-backups/cutover-$ENV-$RUN.sql.gz" \
    '.recoveryReference=$ref' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  run_job ddl 540 600
  if [[ $(jq -r .release.dataMigration "$WORK/record.json") == 6h ]]; then
    run_job data 540 600
    jq -e '.ok==true and .status=="open-success" and .epoch=="scoped"
      and .sealedUnresolved==0 and .maintenanceBarrier==false' "$WORK/verdict.json" >/dev/null || fail 'Protected data migration has not opened'
  fi
}
execute_stages() {
  if [[ ${MODE:-run} != restore ]]; then
    execute_stage 1 'Verify prepared database' verify_prepared_release
    execute_stage 2 Close close_once
    execute_stage 3 'Switch database' switch_db
    execute_stage 4 'Restart API, UI and MCP' restart_services
    execute_stage 5 'Quick private test' private_smoke
    printf '6/6 Reopen\n'; checkpoint stage-6 started; reopen
    return
  fi
  execute_stage 1 Restore restore_stage
  execute_stage 2 Close close_once
  execute_stage 3 Migrate migrate_stage
  execute_stage 4 'Restart API, UI and MCP' restart_services
  execute_stage 5 'Quick private test' private_smoke
  printf '6/6 Reopen\n'; checkpoint stage-6 started; reopen
}
execute_stage() {
  printf '%s/6 %s\n' "$1" "$2"
  checkpoint "stage-$1" started
  "$3"
  checkpoint "stage-$1" completed
}
