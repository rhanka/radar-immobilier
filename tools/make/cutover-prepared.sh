#!/usr/bin/env bash
prepared_read() {
  "${k[@]}" get configmap radar-prepared-db --ignore-not-found -o json > "$WORK/prepared.json"
}
# After the preparing stamp, the longest legitimate preparation is bounded by
# the sum of its stage budgets (drain 600 + resolve 90 + docs 7500 + recon 900
# + reset 90 + restore 1920 + ddl 600 + data 600 + destination 90 = 12390s).
# A slot still preparing past 14400s belongs to an operator that can no longer
# finish (each stage Job also carries a bounded activeDeadlineSeconds), so the
# next prepare converges it to failed instead of refusing every later prepare.
PREPARED_STALE_AFTER_SECONDS=14400
prepared_available() {
  prepared_read
  [[ ! -s $WORK/prepared.json ]] && return 0
  [[ $(jq -r '.data.status // ""' "$WORK/prepared.json") != preparing ]] && return 0
  local stamped
  stamped=$(jq -r 'try (.data.preparedAt | fromdateiso8601) catch empty' "$WORK/prepared.json")
  if [[ -n $stamped ]] && (( $(date +%s) - stamped > PREPARED_STALE_AFTER_SECONDS )); then
    jq --arg at "$(date -u +%FT%TZ)" '.data.status="failed" | .data.smoke="failed" | .data.abandonedAt=$at' \
      "$WORK/prepared.json" > "$WORK/prepared-next.json"
    "${k[@]}" replace -f "$WORK/prepared-next.json" >/dev/null || fail 'Stale prepared slot could not be abandoned'
    printf 'Abandoned prepared slot of run %s: still preparing since %s\n' \
      "$(jq -r '.data.run // "unknown"' "$WORK/prepared.json")" "$(jq -r '.data.preparedAt // "unknown"' "$WORK/prepared.json")"
    return 0
  fi
  fail 'Prepared slot is still preparing'
}
prepared_write() {
  local status=$1 verb=replace
  prepared_read
  if [[ ! -s $WORK/prepared.json ]]; then
    verb=create
    jq -n --arg ns "$NS" '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-prepared-db",namespace:$ns},data:{}}' > "$WORK/prepared.json"
  elif [[ $status != preparing ]]; then
    jq -e --arg run "$RUN" '.data.run==$run and .data.status=="preparing"' "$WORK/prepared.json" >/dev/null || fail 'Prepared slot ownership changed'
  fi
  jq --slurpfile r "$WORK/record.json" --arg status "$status" --arg at "$(date -u +%FT%TZ)" '
    $r[0] as $r|.data={status:$status,run:$r.run,record:($r|tojson),
      backupDate:($r.pin.date//""),manifestSha256:($r.pin.manifestSha256//""),
      pgSha256:($r.pin.pgSha256//""),gitSha:$r.release.gitSha,
      migrations:(($r.jobs.destination.verdict.migrations//0)|tostring),
      liveDb:$r.liveDb,targetDb:($r.targetDb//$r.liveDb),preparedAt:$at,
      recoveryReference:($r.recoveryReference//""),
      smoke:(if $status=="ready" then "pass" else $status end)}' "$WORK/prepared.json" > "$WORK/prepared-next.json"
  "${k[@]}" "$verb" -f "$WORK/prepared-next.json" >/dev/null
}
prepared_slot_lock() {
  jq -n --arg ns "$NS" --rawfile record "$WORK/record.json" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-change-lock",namespace:$ns},data:{record:$record}}' > "$WORK/slot-lock.json"
  "${k[@]}" create -f "$WORK/slot-lock.json" >/dev/null 2>&1 || fail 'Competing operation prevents prepared publication'
  OWNED=1
}
pin_backup() {
  run_job resolve 60 90
  jq -e '.ok==true and (.date|test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
    and (.pgSha256|test("^[a-f0-9]{64}$")) and (.manifestSha256|test("^[a-f0-9]{64}$"))
    and .pgSizeBytes>0 and (.ageHours|type=="number") and .ageHours>=0 and .ageHours<=26' "$WORK/verdict.json" >/dev/null || fail 'Invalid or stale backup pin'
  jq --slurpfile pin "$WORK/verdict.json" '.pin=$pin[0]' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
verify_prepared() {
  prepared_read
  [[ -s $WORK/prepared.json ]] || fail 'Run prepare before cutover'
  jq -e --slurpfile r "$WORK/record.json" --argjson now "$(date +%s)" '
    .data as $d|$d.status=="ready" and $d.smoke=="pass" and $d.gitSha==$r[0].release.gitSha
    and ($d.preparedAt|fromdateiso8601) <= $now
    and $now-($d.preparedAt|fromdateiso8601)<=86400
    and ($d.migrations|tonumber)>0
    and ($d.recoveryReference//""|test("^(s3|postgres)://"))
    and ($d.targetDb=="radar" or $d.targetDb=="radar_next")' "$WORK/prepared.json" >/dev/null || fail 'Prepared stamp is stale, failed or mismatched'
  cp "$WORK/prepared.json" "$WORK/verified-prepared.json"
  run_job database 30 45
  jq --slurpfile db "$WORK/verdict.json" --slurpfile p "$WORK/verified-prepared.json" '
    .liveDb=$db[0].database|.targetDb=$p[0].data.targetDb|.prepared=$p[0].data|
    .recoveryReference=$p[0].data.recoveryReference' \
    "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  jq -e --arg env "$ENV" '.prepared.liveDb==.liveDb and
    (if $env=="preprod" then .liveDb!=.targetDb else .liveDb==.targetDb end)' "$WORK/record.json" >/dev/null || fail 'Prepared database identity changed'
  if [[ $ENV == preprod ]]; then
    BACKUP_ID=latest pin_backup
    jq -e '.prepared.backupDate==.pin.date and .prepared.manifestSha256==.pin.manifestSha256
      and .prepared.pgSha256==.pin.pgSha256' "$WORK/record.json" >/dev/null || fail 'Prepared backup differs from latestComplete'
  fi
  run_job destination 30 45
  jq -e --slurpfile r "$WORK/record.json" '.database==$r[0].targetDb
    and (.migrations|tostring)==$r[0].prepared.migrations' "$WORK/verdict.json" >/dev/null || fail 'Prepared database migration identity changed'
}
