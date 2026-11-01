#!/usr/bin/env bash
maintenance_spec() {
  jq --arg service "base-maintenance-$RUN" '
    walk(if type=="object" and (has("service") or has("resource")) then
      {service:{name:$service,port:{number:80}}} else . end)' "$1"
}
patch_spec() {
  local kind=$1 name=$2 uid=$3 expected=$4 desired=$5 current patch
  current=$("${k[@]}" get "$kind" "$name" -o json)
  patch=$(jq -n --arg uid "$uid" --arg rv "$(jq -r .metadata.resourceVersion <<< "$current")" \
    --argjson expected "$expected" --argjson desired "$desired" \
    '[{op:"test",path:"/metadata/uid",value:$uid},{op:"test",path:"/metadata/resourceVersion",value:$rv},
      {op:"test",path:"/spec",value:$expected},{op:"replace",path:"/spec",value:$desired}]')
  "${k[@]}" patch "$kind" "$name" --type=json -p "$patch" >/dev/null
}
route_maintenance() {
  local row=$1
  local name uid original desired current
    name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
    original=$(jq -c .spec <<< "$row")
    desired=$(maintenance_spec <(printf '%s' "$original"))
    current=$("${k[@]}" get ingress "$name" -o json)
    jq -e --argjson original "$original" --argjson desired "$desired" \
      '.spec==$original or .spec==$desired' <<< "$current" >/dev/null || fail "Ingress conflict: $name"
    patch_spec ingress "$name" "$uid" "$(jq -c .spec <<< "$current")" "$desired" || fail "Ingress CAS conflict: $name"
}
routes_maintenance() {
  local row
  while read -r row; do route_maintenance "$row"; done < <(jq -c '.ingresses[]' "$WORK/record.json")
}
reclose_best_effort() {
  local row failed=0
  while read -r row; do
    (set -e; route_maintenance "$row") || failed=1
  done < <(jq -c '.ingresses[]' "$WORK/record.json")
  return "$failed"
}
patch_uid() {
  local kind=$1 name=$2 uid=$3 change=$4 patch
  patch=$(jq -n --arg uid "$uid" --argjson change "$change" \
    '[{op:"test",path:"/metadata/uid",value:$uid}]+$change')
  "${k[@]}" patch "$kind" "$name" --type=json -p "$patch" >/dev/null
}
stop_schedules() {
  local row failed=0
  while read -r row; do
    patch_uid cronjob "$(jq -r .name <<< "$row")" "$(jq -r .uid <<< "$row")" \
      '[{"op":"add","path":"/spec/suspend","value":true}]' || failed=1
  done < <(jq -c '.cronjobs[]' "$WORK/record.json")
  return "$failed"
}
stop_deployments() {
  local row
  while read -r row; do
    patch_uid deployment "$(jq -r .name <<< "$row")" "$(jq -r .uid <<< "$row")" \
      '[{"op":"add","path":"/spec/replicas","value":0}]'
  done < <(jq -c '.deployments[]' "$WORK/record.json")
}
suspend_writers() {
  local mode=${1:-kill} deadline=$((SECONDS+600)) row name uid
  [[ $mode != kill ]] || deadline=$((SECONDS+40))
  checkpoint suspend started
  # Every recorded CronJob (watchdog included) is suspended and read back before any wait;
  # a failure restores the original schedule states from the inventory record.
  stop_schedules
  schedules_suspended || fail 'Writer schedules are not suspended'
  while :; do
    if [[ $mode != kill ]]; then
      # Drain waits only for live writers: terminated Pods (Error/Completed) never count.
      live_refresh_writers > "$WORK/refresh-writers.json"
      [[ $(jq length "$WORK/refresh-writers.json") != 0 ]] || break
      ((SECONDS<deadline)) || fail "Refresh writer drain exceeded ten minutes; live writers: $(jq -r 'map(.kind+"/"+.name+"("+.phase+")")|join(", ")' "$WORK/refresh-writers.json")"
      sleep 2
      continue
    fi
    owned_refresh_jobs > "$WORK/refresh-jobs.json"
    [[ $(jq length "$WORK/refresh-jobs.json") != 0 ]] || break
    if [[ $mode == kill ]]; then
      while read -r row; do
        name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
        delete_job_uid "$name" "$uid"
        until job_pods_ended "$name" "$uid"; do
          ((SECONDS<deadline)) || fail 'Refresh writer termination deadline exceeded'
          sleep 2
        done
      done < <(jq -c '.[]' "$WORK/refresh-jobs.json")
    fi
    ((SECONDS<deadline)) || fail 'Refresh writer drain exceeded ten minutes'
    sleep 2
  done
  checkpoint suspend completed
}
schedules_suspended() {
  "${k[@]}" get cronjobs -o json | jq -e --slurpfile r "$WORK/record.json" '. as $live|
    all($r[0].cronjobs[]; .uid as $uid|any($live.items[]; .metadata.uid==$uid and .spec.suspend==true))' >/dev/null
}
live_refresh_writers() {
  # Pods are read before Jobs so that a Job created in between counts as a starting writer.
  "${k[@]}" get pods -o json > "$WORK/writer-pods-now.json"
  "${k[@]}" get jobs -o json > "$WORK/writer-jobs-now.json"
  jq -c --slurpfile r "$WORK/record.json" --slurpfile cfg "$CONFIG" --slurpfile jobs "$WORK/writer-jobs-now.json" \
    -f tools/make/cutover-writers.jq "$WORK/writer-pods-now.json"
}
owned_refresh_jobs() {
  "${k[@]}" get jobs -o json | jq --slurpfile r "$WORK/record.json" \
    --slurpfile cfg "$CONFIG" '[.items[]|select(any(.status.conditions[]?;
      (.type=="Complete" or .type=="Failed") and .status=="True")|not)|
      select(any(.metadata.ownerReferences[]?;.controller==true and .kind=="CronJob" and
        (.uid as $uid|any($r[0].cronjobs[];.uid==$uid and (.name as $name|$cfg[0].cronjobs|index($name))))))|
      {name:.metadata.name,uid:.metadata.uid}]'
}
delete_job_uid() {
  local name=$1 uid=$2
  jq -n --arg uid "$uid" '{apiVersion:"v1",kind:"DeleteOptions",propagationPolicy:"Foreground",preconditions:{uid:$uid}}' > "$WORK/delete-job.json"
  "${k[@]}" delete --raw "/apis/batch/v1/namespaces/$NS/jobs/$name" -f "$WORK/delete-job.json" >/dev/null
}
remember_consumers() {
  read_consumers
  jq --slurpfile p "$WORK/consumers.json" '.consumers=((.consumers+[$p[0][].uid])|unique)' \
    "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
verify_closed() {
  local row desired
  # CLOSE_REASON names the last unmet closure condition for the deadline message.
  CLOSE_REASON=consumers
  remember_consumers
  jq -e 'length==0' "$WORK/consumers.json" >/dev/null || return 1
  CLOSE_REASON='refresh Jobs'
  [[ $(owned_refresh_jobs | jq length) == 0 ]] || return 1
  CLOSE_REASON='Deployments not at zero'
  while read -r row; do
    "${k[@]}" get deployment "$(jq -r .name <<< "$row")" -o json |
      jq -e --arg uid "$(jq -r .uid <<< "$row")" '.metadata.uid==$uid and .spec.replicas==0 and (.status.replicas//0)==0' >/dev/null || return 1
  done < <(jq -c '.deployments[]' "$WORK/record.json")
  CLOSE_REASON='Service endpoints'
  "${k[@]}" get endpoints -o json | jq -e 'all(.items[]|select(.metadata.name!="radar-postgres");
    all(.subsets[]?; ((.addresses//[])|length)==0 and ((.notReadyAddresses//[])|length)==0))' >/dev/null || return 1
  CLOSE_REASON='Ingress maintenance spec'
  while read -r row; do
    desired=$(maintenance_spec <(jq .spec <<< "$row"))
    "${k[@]}" get ingress "$(jq -r .name <<< "$row")" -o json |
      jq -e --argjson spec "$desired" '.spec==$spec' >/dev/null || return 1
  done < <(jq -c '.ingresses[]' "$WORK/record.json")
  CLOSE_REASON='public maintenance probe'
  maintenance_probe || return 1
  CLOSE_REASON=
}
close_once() {
  local deadline row REQUEST_DEADLINE
  deadline=$((SECONDS+240))
  [[ ${MODE:-run} == restore ]] || deadline=$((SECONDS+80))
  REQUEST_DEADLINE=$deadline
  checkpoint close started
  # The checkpoint precedes even maintenance-Service creation.
  jq -n --arg ns "$NS" --arg name "base-maintenance-$RUN" \
    '{apiVersion:"v1",kind:"Service",metadata:{name:$name,namespace:$ns},spec:{ports:[{name:"http",port:80,targetPort:80}]}}' > "$WORK/service.json"
  if ! "${k[@]}" create -f "$WORK/service.json" >/dev/null 2>&1; then
    "${k[@]}" get service "base-maintenance-$RUN" -o json | jq -e '(.spec.selector//{}|length)==0' >/dev/null || fail 'Maintenance Service conflict'
  fi
  stop_schedules; routes_maintenance; stop_deployments
  if ((SECONDS+120 < deadline)); then deadline=$((SECONDS+120)); fi
  while :; do
    while read -r row; do delete_job_uid "$(jq -r .name <<< "$row")" "$(jq -r .uid <<< "$row")"; done < <(owned_refresh_jobs | jq -c '.[]')
    if verify_closed; then break; fi
    (( SECONDS < deadline )) || fail "Closure deadline exceeded (${CLOSE_REASON:-unknown}); remain closed"
    sleep 2
  done
  jq --arg at "$(date -u +%FT%TZ)" '.closedAt=$at' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save; checkpoint close completed
}
