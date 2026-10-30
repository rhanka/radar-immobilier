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
}
patch_database() {
  local from=$1 to=$2 patch
  [[ $from =~ ^radar(_next)?$ && $to =~ ^radar(_next)?$ ]] || fail 'Invalid database switch'
  patch=$(jq -n --arg from "$(printf '%s' "$from" | base64 -w0)" --arg to "$(printf '%s' "$to" | base64 -w0)" \
    '[{op:"test",path:"/data/POSTGRES_DB",value:$from},{op:"replace",path:"/data/POSTGRES_DB",value:$to}]')
  "${k[@]}" patch secret radar-db-credentials --type=json -p "$patch" >/dev/null
}
switch_db() {
  [[ $ENV == preprod ]] || return 0
  [[ $(jq -r '.checkpoints.switch//""' "$WORK/record.json") != completed ]] || return 0
  run_job recon 60 75
  checkpoint switch started
  local from to
  from=$(jq -r .liveDb "$WORK/record.json"); to=$(jq -r .targetDb "$WORK/record.json")
  patch_database "$from" "$to" || patch_database "$to" "$to" || fail 'Database switch failed'
  "${k[@]}" patch configmap radar-api --type=merge -p '{"data":{"GEO_DOCUMENTS_REPOINT":null}}' >/dev/null
  checkpoint switch completed
}
rollback_stages() {
  jq -e '.previousRelease!=null and .checkpoints.close!=null and .prepared!=null' "$WORK/record.json" >/dev/null || fail 'No prepared cutover to roll back'
  close_once
  if [[ $ENV == preprod ]]; then
    local previous
    previous=$(jq -r .liveDb "$WORK/record.json")
    patch_database "$(jq -r .prepared.targetDb "$WORK/record.json")" "$previous" || patch_database "$previous" "$previous"
  fi
  jq '.release=.previousRelease|.checkpoints.switch="rolled-back"' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  restart_services
  private_smoke
  reopen
}
