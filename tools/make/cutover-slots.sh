#!/usr/bin/env bash
# Blue/green slots. Canonical Deployments carry `sentropic.io/slot=main`; the prepared
# stack carries `slot=prepared`. Services route by that label only; Ingresses never change.
SLOT_LABEL=sentropic.io/slot
SLOT_PATH=/spec/selector/sentropic.io~1slot
# Switch order api -> mcp -> ui (callers first); reverse order to go back.
SLOT_SERVICES=(radar-api radar-immo-mcp radar-ui)
now_ms() { date +%s%3N; }
drain_pause() {
  local drain=${DRAIN:-15}
  [[ $drain =~ ^[0-9]{1,3}$ ]] || fail 'DRAIN must be a number of seconds'
  ((drain == 0)) || sleep "$drain"
}
slices_on() {
  # True when the Service's EndpointSlices list only `slot=$2` Pods, at least one ready.
  local svc=$1 slot=$2
  "${k[@]}" get pods -o json > "$WORK/slot-pods.json"
  "${k[@]}" get endpointslices -l "kubernetes.io/service-name=$svc" -o json |
    jq -e --arg sl "$SLOT_LABEL" --arg slot "$slot" --slurpfile pods "$WORK/slot-pods.json" '
      [.items[].endpoints[]?] as $e|($e|length)>0 and any($e[]; .conditions.ready!=false) and
      all($e[]; .targetRef.uid as $uid|any($pods[0].items[]; .metadata.uid==$uid and .metadata.labels[$sl]==$slot))' >/dev/null
}
wait_slices() {
  local svc=$1 slot=$2 deadline=$((SECONDS+${3:-120}))
  until slices_on "$svc" "$slot"; do
    ((SECONDS < deadline)) || fail "EndpointSlices of $svc do not list only slot=$slot Pods"
    sleep 0.2
  done
}
select_slot() {
  # Compare-and-swap on the slot selector value: no prior read, idempotent on a rerun.
  local svc=$1 from=$2 to=$3 patch
  patch=$(jq -n --arg path "$SLOT_PATH" --arg from "$from" --arg to "$to" \
    '[{op:"test",path:$path,value:$from},{op:"replace",path:$path,value:$to}]')
  "${k[@]}" patch service "$svc" --type=json -p "$patch" >/dev/null 2> "$WORK/slot-cas.err" && return
  patch=$(jq -n --arg path "$SLOT_PATH" --arg to "$to" '[{op:"test",path:$path,value:$to}]')
  "${k[@]}" patch service "$svc" --type=json -p "$patch" >/dev/null 2>&1 && return
  cat "$WORK/slot-cas.err" >&2
  fail "Service $svc selector is neither slot=$from nor slot=$to"
}
adopt_deployment() {
  local name=$1 component current selector deadline
  "${k[@]}" get deployment "$name" -o json > "$WORK/adopt.json" || unknown_state "Deployment state unknown: $name"
  component=$(jq -er '.spec.template.metadata.labels["app.kubernetes.io/component"]' "$WORK/adopt.json") || fail "Unlabelled Deployment: $name"
  if ! jq -e --arg l "$SLOT_LABEL" '.spec.selector.matchLabels[$l]=="main"' "$WORK/adopt.json" >/dev/null; then
    jq -e --arg l "$SLOT_LABEL" '.spec.selector.matchLabels[$l]==null' "$WORK/adopt.json" >/dev/null || fail "Unexpected slot selector: $name"
    # The last-applied annotation is kept: a later client-side apply of the unlabelled
    # manifest leaves the controller-added slot label in place (three-way merge).
    jq --arg l "$SLOT_LABEL" '{apiVersion,kind,metadata:{name:.metadata.name,namespace:.metadata.namespace,
        labels:.metadata.labels,annotations:((.metadata.annotations//{})|del(.["deployment.kubernetes.io/revision"]))},
      spec:(.spec|.selector.matchLabels[$l]="main"|.template.metadata.labels[$l]="main")}' "$WORK/adopt.json" > "$WORK/adopted.json"
    jq -n --arg uid "$(jq -r .metadata.uid "$WORK/adopt.json")" \
      '{apiVersion:"v1",kind:"DeleteOptions",propagationPolicy:"Orphan",preconditions:{uid:$uid}}' > "$WORK/orphan.json"
    # Orphaning keeps the running ReplicaSet and its Pods serving through the unchanged Service.
    "${k[@]}" delete --raw "/apis/apps/v1/namespaces/$NS/deployments/$name" -f "$WORK/orphan.json" >/dev/null || fail "Orphaning refused: $name"
    deadline=$((SECONDS+60))
    while :; do
      current=$("${k[@]}" get deployment "$name" --ignore-not-found -o name) || unknown_state "Deployment state unknown: $name"
      [[ -n $current ]] || break
      ((SECONDS < deadline)) || fail "Orphaned Deployment still present: $name"
      sleep 1
    done
    "${k[@]}" create -f "$WORK/adopted.json" >/dev/null || fail "Slot Deployment creation failed: $name"
  fi
  "${k[@]}" rollout status "deployment/$name" --timeout=300s >/dev/null || fail "Slot Deployment not Ready: $name"
  "${k[@]}" get service "$name" -o json > "$WORK/adopt-service.json" || unknown_state "Service routing unknown: $name"
  if jq -e --arg l "$SLOT_LABEL" '.spec.selector[$l]==null' "$WORK/adopt-service.json" >/dev/null; then
    selector=$(jq -c .spec.selector "$WORK/adopt-service.json")
    "${k[@]}" patch service "$name" --type=json -p "$(jq -n --argjson s "$selector" --arg path "$SLOT_PATH" \
      '[{op:"test",path:"/spec/selector",value:$s},{op:"add",path:$path,value:"main"}]')" >/dev/null || fail "Service selector changed concurrently: $name"
  fi
  jq -e --arg l "$SLOT_LABEL" '(.spec.selector[$l]//"main")=="main"' "$WORK/adopt-service.json" >/dev/null || fail "Service $name is not on slot=main"
  wait_slices "$name" main
  drain_pause
  # Orphaned ReplicaSets (no controller, same component, no slot label) end only after routing left them.
  "${k[@]}" get replicasets -o json | jq -c --arg c "$component" --arg l "$SLOT_LABEL" '.items[]|
    select(([.metadata.ownerReferences[]?|select(.controller==true)]|length)==0)|
    select(.spec.selector.matchLabels["app.kubernetes.io/component"]==$c and .spec.selector.matchLabels[$l]==null)|
    {name:.metadata.name,uid:.metadata.uid}' > "$WORK/orphans.jsonl"
  # R5: the orphaned Pods are followed by the log export until their containers exit.
  "${k[@]}" get pods -o json | jq -c --slurpfile o <(jq -s . "$WORK/orphans.jsonl") '[.items[]|
    select(any(.metadata.ownerReferences[]?; .kind=="ReplicaSet" and (.uid as $u|any($o[0][]; .uid==$u))))|
    {name:.metadata.name,uid:.metadata.uid}]' > "$WORK/orphan-pods.json"
  start_pod_logs orphan "$(cat "$WORK/orphan-pods.json")"
  while read -r current; do
    jq -n --arg uid "$(jq -r .uid <<< "$current")" \
      '{apiVersion:"v1",kind:"DeleteOptions",propagationPolicy:"Background",preconditions:{uid:$uid}}' > "$WORK/orphan-rs.json"
    "${k[@]}" delete --raw "/apis/apps/v1/namespaces/$NS/replicasets/$(jq -r .name <<< "$current")" -f "$WORK/orphan-rs.json" >/dev/null ||
      fail 'Orphaned ReplicaSet deletion refused'
  done < "$WORK/orphans.jsonl"
  finish_pod_logs "$LOG_STEP"
  printf 'Adopted %s on slot=main\n' "$name"
}
slots_adopt() {
  # One-time, under the change lock; rerunnable after any interruption.
  lock_acquire adopt
  # The log export Job of the orphaned Pods runs the deployed API image.
  deployed_release
  local name
  for name in "${SLOT_SERVICES[@]}"; do adopt_deployment "$name"; done
  lock_delete
}
slots_adopted() {
  # Every canonical Deployment selects and labels slot=main and every canonical Service selects
  # by slot: the prepared Pods (slot=prepared) can then never be routed before a switch.
  # Returns 0 adopted, 1 not adopted (objects read, or absent), 2 unknown: an API error or timeout
  # is never read as "not adopted" (that would allow a direct roll over adopted slots).
  local name state=0
  for name in "${SLOT_SERVICES[@]}"; do
    "${k[@]}" get deployment "$name" --ignore-not-found -o json > "$WORK/slot-deployment.json" 2>/dev/null || return 2
    "${k[@]}" get service "$name" --ignore-not-found -o json > "$WORK/slot-service.json" 2>/dev/null || return 2
    jq -e --arg l "$SLOT_LABEL" '.spec.selector.matchLabels[$l]=="main" and .spec.template.metadata.labels[$l]=="main"' \
      "$WORK/slot-deployment.json" >/dev/null 2>&1 || state=1
    jq -e --arg l "$SLOT_LABEL" '.spec.selector[$l]=="main" or .spec.selector[$l]=="prepared"' \
      "$WORK/slot-service.json" >/dev/null 2>&1 || state=1
  done
  return "$state"
}
slots_state() {
  # adopted | legacy; an unreadable state refuses (the CI guard then refuses any direct roll).
  local rc=0
  slots_adopted || rc=$?
  case $rc in
    0) echo adopted;;
    1) echo legacy;;
    *) fail 'slots_state_unknown: canonical Deployments or Services unreadable';;
  esac
}
require_slots() {
  local rc=0
  slots_adopted || rc=$?
  ((rc != 2)) || fail 'slots_state_unknown: canonical Deployments or Services unreadable'
  ((rc == 0)) || fail 'slots_not_adopted: run slots-adopt (one-time, operator) before any blue/green preparation or cutover'
}
