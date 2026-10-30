#!/usr/bin/env bash
# Zero-downtime release cutover: blue/green by Service selector (see README).
#   1 verify prepared stamp and slot  2 freeze (preprod)  3 switch to prepared  4 observe (drill)
#   5 promote (logs, database selection, canonical re-roll, switch back, prepared logs + delete)
#   6 finalize (CronJob images, schedules, receipt)
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
record_set() {
  # record_set <jq filter> [jq args...]: update and persist the recovery record.
  local filter=$1; shift
  jq "$@" "$filter" "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
iso_ms() { date -u +%FT%T.%3NZ; }
samedb() { [[ $ENV == prod || ${SAMEDB:-0} == 1 ]]; }
slot_pods() {
  "${k[@]}" get pods -o json | jq -c --arg l "$SLOT_LABEL" --arg slot "$1" '[.items[]|
    select(.metadata.labels[$l]==$slot and (.metadata.labels["app.kubernetes.io/component"]|IN("api","mcp","ui")))|
    select(.status.phase=="Running" or .status.phase=="Pending")|{name:.metadata.name,uid:.metadata.uid}]'
}
export_slot_logs() {
  # R5: every container log of the slot is in the verified manifest before any of its Pods goes.
  local slot=$1 step pods
  step="logs${slot}$(jq '[.jobs|keys[]|select(startswith("logs"))]|length' "$WORK/record.json")"
  pods=$(slot_pods "$slot")
  [[ $(jq length <<< "$pods") != 0 ]] || return 0
  record_set '.logPods[$step]=$pods' --arg step "$step" --argjson pods "$pods"
  run_job "$step" 300 330
  jq -e --argjson pods "$pods" '(.podUids//[]) as $done|all($pods[]; .uid as $u|$done|index($u))' "$WORK/verdict.json" >/dev/null ||
    fail "Log manifest misses a recorded Pod of slot=$slot; deletion refused"
}
prepared_stack_retire() {
  prepared_stack_present || return 0
  export_slot_logs prepared
  prepared_stack_delete
}
served_matches() {
  # The public routes serve the expected API and UI builds.
  local result
  result=$(curl -q -sS --max-time 3 -o "$WORK/served-health" -w '%{http_code} %{content_type}' "$URL/health" 2>/dev/null) || return 1
  [[ ${result%% *} == 200 ]] && jq -e --arg sha "$1" '.sha==$sha' "$WORK/served-health" >/dev/null 2>&1 || return 1
  result=$(curl -q -sS --max-time 3 -o "$WORK/served-build" -w '%{http_code} %{content_type}' "$URL/build.json" 2>/dev/null) || return 1
  [[ ${result%% *} == 200 ]] && jq -e --arg sha "$2" '.sha==$sha' "$WORK/served-build" >/dev/null 2>&1
}
wait_served() {
  local api=$1 ui=$2 deadline=$((SECONDS+$3))
  until served_matches "$api" "$ui"; do
    ((SECONDS < deadline)) || return 1
    sleep 0.2
  done
}
switch_services() {
  # One CAS patch per Service, callers first; then every EndpointSlice on the target slot.
  local from=$1 to=$2 svc started order
  if [[ $to == prepared ]]; then order=("${SLOT_SERVICES[@]}"); else order=(radar-ui radar-immo-mcp radar-api); fi
  started=$(now_ms)
  for svc in "${order[@]}"; do select_slot "$svc" "$from" "$to"; done
  for svc in "${order[@]}"; do wait_slices "$svc" "$to" 60; done
  record_set '.slot=$to|.switches=((.switches//[])+[{to:$to,at:$at,mixedWindowMs:$ms}])' \
    --arg to "$to" --arg at "$(iso_ms)" --argjson ms "$(( $(now_ms) - started ))"
  printf 'Routing on slot=%s (mixed window %s ms)\n' "$to" "$(jq -r '.switches[-1].mixedWindowMs' "$WORK/record.json")"
}
back_to_main() {
  # Routing back first (reads and writes served by the previous release), then writes reopen.
  if [[ $(jq -r '.slot//"main"' "$WORK/record.json") == prepared ]]; then switch_services prepared main; fi
  if jq -e '.frozenAt!=null and .unfrozenAt==null' "$WORK/record.json" >/dev/null; then
    JOB_POLL=0.5 run_job unfreeze 60 90
    record_set '.unfrozenAt=$v[0].unfrozenAt' --slurpfile v "$WORK/verdict.json"
  fi
}
verify_prepared_release() {
  verify_prepared
  if ! jq -e '.previousRelease!=null' "$WORK/record.json" >/dev/null; then
    cp "$WORK/record.json" "$WORK/intended-release.json"
    deployed_release
    jq --slurpfile intended "$WORK/intended-release.json" '.release as $old|
      $intended[0]|.previousRelease=$old' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
  fi
  # The document re-check lists the whole preprod bucket: before anything is switched.
  [[ $ENV != preprod ]] || run_job recon 840 900
  local db
  if samedb; then db=$(jq -r .liveDb "$WORK/record.json"); else db=$(jq -r .targetDb "$WORK/record.json"); fi
  record_set '.samedb=$same|.slotDb=$db' --argjson same "$(samedb && echo true || echo false)" --arg db "$db"
  # The slot must run the release on the selected database; otherwise it is (re)started.
  if ! "${k[@]}" get deployment radar-api-prepared --ignore-not-found -o json | jq -e --slurpfile r "$WORK/record.json" '
      .metadata.annotations["sentropic.io/prepared-db"]==$r[0].slotDb and
      .spec.template.spec.containers[0].image==$r[0].release.apiImage' >/dev/null 2>&1; then
    prepared_stack_retire
    prepared_stack_up "$db"
  fi
  local name
  for name in "${PREPARED_NAMES[@]}"; do
    "${k[@]}" rollout status "deployment/$name-prepared" --timeout=300s >/dev/null || fail "Prepared slot not Ready: $name"
    wait_slices "$name-prepared" prepared
  done
}
freeze_stage() {
  samedb && return 0
  jq -e '.frozenAt!=null' "$WORK/record.json" >/dev/null && return 0
  JOB_POLL=0.5 run_job freeze 60 90
  record_set '.frozenAt=$v[0].frozenAt|.freezeStartedAt=$v[0].freezeStartedAt' --slurpfile v "$WORK/verdict.json"
  printf 'Live database %s read-only from %s\n' "$(jq -r .liveDb "$WORK/record.json")" "$(jq -r .frozenAt "$WORK/record.json")"
}
switch_stage() {
  switch_services main prepared
  if ! wait_served "$(jq -r .release.apiServedSha "$WORK/record.json")" "$(jq -r .release.uiServedSha "$WORK/record.json")" "${SERVE_TIMEOUT:-30}"; then
    back_to_main; fail 'Prepared slot not served after the switch; routing returned to slot=main'
  fi
  # Freeze window (owner limit 10 s): first refused write possible (ALTER) -> first green response.
  record_set 'def epochms: (sub("\\.[0-9]+Z$";"Z")|fromdateiso8601)*1000+(capture("\\.(?<ms>[0-9]+)Z$").ms|tonumber);
    .firstGreenAt=$at|if .freezeStartedAt then .freezeWindowMs=(($at|epochms)-(.freezeStartedAt|epochms)) else . end' --arg at "$(iso_ms)"
  if ! (set -e; smoke_pass "$URL" "$URL"); then
    back_to_main; fail 'Public smoke failed on the prepared slot; routing returned to slot=main'
  fi
}
observe_stage() {
  local observe=${OBSERVE:-600} end
  [[ $observe =~ ^[0-9]{1,5}$ ]] || fail 'OBSERVE must be a number of seconds'
  end=$((SECONDS+observe))
  local api ui
  api=$(jq -r .release.apiServedSha "$WORK/record.json"); ui=$(jq -r .release.uiServedSha "$WORK/record.json")
  while ((SECONDS < end)); do
    if ! wait_served "$api" "$ui" 5; then back_to_main; fail 'Prepared slot degraded during retention; routing returned to slot=main'; fi
    sleep 5
  done
  [[ ${DRILL:-0} == 1 ]] || return 0
  # Drill: routing rollback (reads on the previous release; preprod writes stay 503 while frozen), then re-switch.
  local started
  started=$(now_ms)
  switch_services prepared main
  wait_served "$(jq -r .previousRelease.apiServedSha "$WORK/record.json")" "$(jq -r .previousRelease.uiServedSha "$WORK/record.json")" 5 ||
    fail 'Drill: previous release not served within 5 s'
  record_set '.drill={backMs:$ms}' --argjson ms "$(( $(now_ms) - started ))"
  switch_services main prepared
  wait_served "$api" "$ui" 30 || { back_to_main; fail 'Drill: release not served again after the re-switch'; }
}
canonical_smoke() {
  # Canonical Pods answer directly (the Services still route to the prepared slot).
  local deadline=$((SECONDS+90)) ui api mcp
  start_forward deployment/radar-ui :8080 "$WORK/ui-forward"
  start_forward deployment/radar-api :3000 "$WORK/api-forward"
  start_forward deployment/radar-immo-mcp :8848 "$WORK/mcp-forward"
  until grep -q 'Forwarding from 127.0.0.1:' "$WORK/ui-forward" && grep -q 'Forwarding from 127.0.0.1:' "$WORK/api-forward" &&
    grep -q 'Forwarding from 127.0.0.1:' "$WORK/mcp-forward"; do
    ((SECONDS<deadline)) || fail 'Canonical forwarding unavailable'
    sleep 1
  done
  ui=http://127.0.0.1:$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/ui-forward" | head -1)
  api=http://127.0.0.1:$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/api-forward" | head -1)
  mcp=http://127.0.0.1:$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/mcp-forward" | head -1)
  http_check "$ui" / 200 html "$deadline"
  http_check "$ui" /build.json 200 build "$deadline"
  http_check "$api" /health 200 health "$deadline"
  http_check "$api" /api/v1/workspaces 401 auth "$deadline"
  http_check "$mcp" /mcp 401 bearer "$deadline"
  http_check "$mcp" /.well-known/oauth-protected-resource/mcp 200 metadata "$deadline"
  stop_forwards
}
reroll_canonical() {
  # Images and a per-run template annotation: a new ReplicaSet even on an identical SHA.
  local name current desired
  for name in "${SLOT_SERVICES[@]}"; do
    if ! jq -e --arg n "$name" '.promotion.oldHashes[$n]!=null' "$WORK/record.json" >/dev/null; then
      record_set '.promotion.oldHashes[$n]=$h' --arg n "$name" --arg h "$("${k[@]}" get pods -o json | jq -r --arg l "$SLOT_LABEL" --arg n "$name" '
        [.items[]|select(.metadata.labels[$l]=="main" and any(.metadata.ownerReferences[]?; .kind=="ReplicaSet" and (.name//""|startswith($n))))|
          .metadata.labels["pod-template-hash"]]|first//""')"
    fi
    current=$("${k[@]}" get deployment "$name" -o json)
    desired=$(jq --slurpfile r "$WORK/record.json" '.spec|
      .template.metadata.annotations=((.template.metadata.annotations//{})|.["sentropic.io/promoted-run"]=$r[0].run)|
      (.template.spec.containers[],.template.spec.initContainers[]?) |=
        (if (.image|test("^ghcr.io/rhanka/radar-api[:@]")) then .image=$r[0].release.apiImage
          elif (.image|test("^ghcr.io/rhanka/radar-ui[:@]")) then .image=$r[0].release.uiImage else . end)' <<< "$current")
    patch_spec deployment "$name" "$(jq -r .metadata.uid <<< "$current")" "$(jq -c .spec <<< "$current")" "$desired"
  done
  for name in "${SLOT_SERVICES[@]}"; do
    "${k[@]}" rollout status "deployment/$name" --timeout=300s >/dev/null || fail "Canonical re-roll failed: $name"
    "${k[@]}" get pods -o json | jq -e --arg l "$SLOT_LABEL" --arg n "$name" --slurpfile r "$WORK/record.json" '
      [.items[]|select(.metadata.labels[$l]=="main" and .status.phase=="Running" and
        any(.metadata.ownerReferences[]?; .kind=="ReplicaSet" and (.name//""|startswith($n))))] as $p|
      ($p|length)>0 and all($p[]; .metadata.labels["pod-template-hash"]!=$r[0].promotion.oldHashes[$n]
        and all(.status.containerStatuses[]?; .ready))' >/dev/null || fail "No new ready ReplicaSet for $name"
  done
}
promote_stage() {
  # Order: export canonical logs, select the database, re-roll canonical, verify, route back,
  # drain, export prepared logs, delete the prepared slot.
  jq -e '.promotion.mainLogs==true' "$WORK/record.json" >/dev/null || {
    export_slot_logs main; record_set '.promotion.mainLogs=true'; }
  if ! samedb; then
    select_database "$(jq -r .liveDb "$WORK/record.json")" "$(jq -r .targetDb "$WORK/record.json")" || fail 'Database selection failed'
    "${k[@]}" patch configmap radar-api --type=merge -p '{"data":{"GEO_DOCUMENTS_REPOINT":null}}' >/dev/null
  fi
  reroll_canonical
  canonical_smoke
  run_job identity 30 45
  jq -e --slurpfile r "$WORK/record.json" '.database==(if $r[0].samedb then $r[0].liveDb else $r[0].targetDb end)' \
    "$WORK/verdict.json" >/dev/null || fail 'Canonical database identity mismatch'
  [[ $(jq -r '.slot//"main"' "$WORK/record.json") == main ]] || switch_services prepared main
  wait_served "$(jq -r .release.apiServedSha "$WORK/record.json")" "$(jq -r .release.uiServedSha "$WORK/record.json")" 30 ||
    fail 'Promoted canonical slot not served'
  drain_pause
  prepared_stack_retire
  checkpoint promote completed
}
finalize_stage() {
  local row name uid current desired
  while read -r row; do
    name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
    current=$("${k[@]}" get cronjob "$name" -o json)
    desired=$(jq --slurpfile r "$WORK/record.json" '.spec|
      (.jobTemplate.spec.template.spec.containers[],.jobTemplate.spec.template.spec.initContainers[]?) |=
        (if (.image|test("^ghcr.io/rhanka/radar-api[:@]")) then .image=$r[0].release.apiImage else . end)' <<< "$current")
    patch_spec cronjob "$name" "$uid" "$(jq -c .spec <<< "$current")" "$desired"
  done < <(jq -c --slurpfile cfg "$CONFIG" '.cronjobs[]|select(.name as $n|$cfg[0].cronjobs|index($n))' "$WORK/record.json")
  restore_schedules
  smoke_pass "$URL" "$URL"
  verify_restored
  while read -r row; do
    name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
    "${k[@]}" get job "$name" -o json | jq -e --arg uid "$uid" \
      '.metadata.uid==$uid and any(.status.conditions[]?;(.type=="Complete" or .type=="Failed") and .status=="True")' >/dev/null || fail 'Final Job evidence is not terminal'
    job_pods_ended "$name" "$uid" || fail 'An operation Job still has live consumers'
  done < <(jq -c '.jobs[]' "$WORK/record.json")
  if ! samedb && [[ -z $(jq -r '.rollbackOf//""' "$WORK/record.json") ]]; then
    "${k[@]}" patch configmap radar-prepared-db --type=merge -p '{"data":{"status":"consumed"}}' >/dev/null
  fi
  jq -n --arg ns "$NS" --slurpfile r "$WORK/record.json" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-cutover-receipt",namespace:$ns},data:{receipt:($r[0]|tojson)}}' > "$WORK/receipt.json"
  "${k[@]}" apply -f "$WORK/receipt.json" >/dev/null
  lock_delete
  printf 'SUCCESS: release %s served by slot=main without interruption (%s)\n' "$(jq -r .release.gitSha "$WORK/record.json")" "$RUN"
}
bluegreen_stages() {
  if jq -e '.checkpoints.promote!=null' "$WORK/record.json" >/dev/null; then
    execute_stage 5 Promote promote_stage
    printf '6/6 Finalize\n'; checkpoint stage-6 started; finalize_stage
    return
  fi
  if [[ ${RECOVERING:-0} == 1 ]]; then bluegreen_abandon; fi
  execute_stage 1 'Verify prepared slot' verify_prepared_release
  execute_stage 2 'Freeze live writes' freeze_stage
  execute_stage 3 'Switch to prepared slot' switch_stage
  execute_stage 4 Observe observe_stage
  checkpoint promote started
  execute_stage 5 Promote promote_stage
  # The lock is released inside finalize: no completion checkpoint after it.
  printf '6/6 Finalize\n'; checkpoint stage-6 started; finalize_stage
}
bluegreen_abandon() {
  # Before promotion: routing back to slot=main, writes reopened, schedules restored.
  back_to_main
  restore_schedules
  lock_delete
  fail 'Cutover abandoned before promotion; slot=main serves the previous release'
}
rollback_command() {
  "${k[@]}" get configmap radar-change-lock --ignore-not-found -o json > "$WORK/lock.json"
  if [[ -s $WORK/lock.json ]] && jq -e --arg run "${RUN:-}" '(.data.record|fromjson).run==$run' "$WORK/lock.json" >/dev/null; then
    lock_resume
    jq -e '.checkpoints.promote==null' "$WORK/record.json" >/dev/null || fail 'Promotion started: resume RUN= first, then rollback RUN='
    back_to_main
    restore_schedules
    lock_delete
    printf 'Rolled back: slot=main serves the previous release (%s)\n' "$RUN"
    return
  fi
  rollback_promoted
}
rollback_promoted() {
  # After promotion: a prepared slot is rebuilt from .previousRelease, then switched and promoted.
  local original=${RUN:-}
  "${k[@]}" get configmap radar-cutover-receipt -o json | jq -e '.data.receipt|fromjson' > "$WORK/receipt.json" || fail 'No cutover receipt'
  jq -e --arg run "$original" '.run==$run and .checkpoints.promote=="completed" and .previousRelease!=null' "$WORK/receipt.json" >/dev/null ||
    fail 'RUN is not the last promoted cutover'
  lock_acquire cutover
  jq --slurpfile x "$WORK/receipt.json" '$x[0] as $x|.mode="run"|.rollbackOf=$x.run|.release=$x.previousRelease|.previousRelease=$x.release|
    .environment=$x.environment|.liveDb=(if $x.samedb then $x.liveDb else $x.targetDb end)|.targetDb=$x.liveDb' \
    "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  SAMEDB=$(jq -r 'if .samedb then 1 else 0 end' "$WORK/receipt.json")
  inventory
  suspend_writers drain
  record_set '.samedb=$s|.slotDb=(if $s then .liveDb else .targetDb end)' --argjson s "$( ((SAMEDB==1)) || [[ $ENV == prod ]] && echo true || echo false)"
  prepared_stack_retire
  prepared_stack_up "$(jq -r .slotDb "$WORK/record.json")"
  if ! samedb; then
    # The retained previous database was frozen by the original cutover: it accepts writes again.
    record_set '.freezeDb=.targetDb'
    JOB_POLL=0.5 run_job unfreezeprev 60 90
    record_set 'del(.freezeDb)'
  fi
  execute_stage 2 'Freeze live writes' freeze_stage
  execute_stage 3 'Switch to prepared slot' switch_stage
  checkpoint promote started
  execute_stage 5 Promote promote_stage
  # The lock is released inside finalize: no completion checkpoint after it.
  printf '6/6 Finalize\n'; checkpoint stage-6 started; finalize_stage
}
