#!/usr/bin/env bash
prepare_database() {
  validate_release "${RELEASE:-}"
  lock_acquire prepare
  prepared_available
  save_release "$RELEASE"
  inventory
  checkpoint suspend started
  stop_schedules
  run_job database 30 45
  jq --arg at "$(date -u +%FT%TZ)" --slurpfile db "$WORK/verdict.json" --arg env "$ENV" '
    .liveDb=$db[0].database|.preparedStartedAt=$at|
    if $env=="preprod" then .targetDb=(if .liveDb=="radar" then "radar_next" else "radar" end) else . end' \
    "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  prepared_write preparing
  PREPARING=1
  RECORD_MAP=radar-prepared-db
  lock_delete
  suspend_writers drain
  if [[ $ENV == preprod ]]; then
    pin_backup
    run_job docs 7200 7500
    run_job recon 840 900
    run_job reset 60 90
    run_job restore 1800 1920
    run_job ddl 540 600
    if [[ $(jq -r .release.dataMigration "$WORK/record.json") == 6h ]]; then
      prepared_data_evidence
      run_job data 540 600
      verify_data_migration
    fi
  else
    run_job backup 840 900
    # Production preparation verifies the live schema; it never restores it.
    jq '.targetDb=.liveDb' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
  fi
  run_job destination 60 90
  prepared_smoke
  prepared_slot_lock
  restore_schedules
  prepared_write ready
  PREPARING=0
  lock_delete
  printf 'Prepared database ready for release\n'
}
prepared_data_evidence() {
  "${k[@]}" get pods -o json > "$WORK/prepared-writers.json"
  jq -e --slurpfile r "$WORK/record.json" 'all(["restore","ddl"][]; . as $step|
    any(.items[]; .status.phase=="Succeeded" and any(.metadata.ownerReferences[]?;
      .kind=="Job" and .controller==true and .uid==$r[0].jobs[$step].uid)))' \
    "$WORK/prepared-writers.json" >/dev/null || fail 'Missing terminated prepared-writer evidence'
  jq --slurpfile pods "$WORK/prepared-writers.json" --arg at "$(date -u +%FT%TZ)" '
    . as $r|.preparedDrainedAt=$at|.preparedConsumers=[$pods[0].items[]|
      select(any(.metadata.ownerReferences[]?; .kind=="Job" and .controller==true and
        (.uid==$r.jobs.restore.uid or .uid==$r.jobs.ddl.uid)))|.metadata.uid]' \
    "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
prepare_failed() {
  stop_forwards
  stop_operation_jobs || return 1
  prepared_smoke_delete || return 1
  if [[ $ENV == preprod ]] && jq -e '.checkpoints.reset!=null' "$WORK/record.json" >/dev/null; then
    run_job discard 60 90 || return 1
  fi
  # Serialize restoration of the original schedules with all other writers.
  if [[ $OWNED != 1 ]]; then prepared_slot_lock || return 1; fi
  restore_schedules || return 1
  prepared_write failed || return 1
  lock_delete
}
verify_data_migration() {
  jq -e '.ok==true and .status=="open-success" and .epoch=="scoped"
    and .sealedUnresolved==0 and .maintenanceBarrier==false' "$WORK/verdict.json" >/dev/null || fail 'Protected data migration has not opened'
}
