#!/usr/bin/env bash
verify_prepared_release() {
  if jq -e '.checkpoints.close!=null and .prepared!=null' "$WORK/record.json" >/dev/null; then
    jq -e '.release.gitSha==.prepared.gitSha and .targetDb==.prepared.targetDb' "$WORK/record.json" >/dev/null || fail 'Recovery prepared identity changed'
    return
  fi
  verify_prepared
  if ! jq -e '.previousRelease!=null' "$WORK/record.json" >/dev/null; then
    cp "$WORK/record.json" "$WORK/intended-release.json"
    deployed_release
    jq --slurpfile intended "$WORK/intended-release.json" '.release as $old|
      $intended[0]|.previousRelease=$old' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
  fi
  # The document re-check lists the whole preprod bucket (about 100 s): it runs
  # before closure, after writers are suspended, with the preparation budget.
  [[ $ENV != preprod ]] || run_job recon 840 900
}
patch_database() {
  local from=$1 to=$2 patch
  [[ $from =~ ^radar(_next)?$ && $to =~ ^radar(_next)?$ ]] || fail 'Invalid database switch'
  patch=$(jq -n --arg from "$(printf '%s' "$from" | base64 -w0)" --arg to "$(printf '%s' "$to" | base64 -w0)" \
    '[{op:"test",path:"/data/POSTGRES_DB",value:$from},{op:"replace",path:"/data/POSTGRES_DB",value:$to}]')
  "${k[@]}" patch secret radar-db-credentials --type=json -p "$patch" >/dev/null
}
select_database() {
  # The controller cannot read the Secret: compare-and-set from the expected value,
  # else prove it is already selected. An expected CAS mismatch stays silent.
  local from=$1 to=$2
  patch_database "$from" "$to" 2> "$WORK/database-cas.err" && return
  patch_database "$to" "$to" && return
  cat "$WORK/database-cas.err" >&2
  return 1
}
switch_db() {
  [[ $ENV == preprod ]] || return 0
  [[ $(jq -r '.checkpoints.switch//""' "$WORK/record.json") != completed ]] || return 0
  jq -e '.jobs.recon.outcome=="completed"' "$WORK/record.json" >/dev/null || fail 'Document reconciliation evidence missing'
  checkpoint switch started
  local from to
  from=$(jq -r .liveDb "$WORK/record.json"); to=$(jq -r .targetDb "$WORK/record.json")
  select_database "$from" "$to" || fail 'Database switch failed'
  "${k[@]}" patch configmap radar-api --type=merge -p '{"data":{"GEO_DOCUMENTS_REPOINT":null}}' >/dev/null
  checkpoint switch completed
}
rollback_stages() {
  jq -e '.previousRelease!=null and .checkpoints.close!=null and .prepared!=null and (.recoveryReference//""|length>0)' "$WORK/record.json" >/dev/null || fail 'No prepared cutover to roll back'
  printf 'Rollback recovery reference: %s\n' "$(jq -r .recoveryReference "$WORK/record.json")"
  close_once
  if [[ $ENV == preprod ]]; then
    local previous
    previous=$(jq -r .liveDb "$WORK/record.json")
    select_database "$(jq -r .prepared.targetDb "$WORK/record.json")" "$previous" || fail 'Database rollback failed'
  fi
  jq '.release=.previousRelease|.checkpoints.switch="rolled-back"' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  restart_services
  private_smoke
  reopen
}
