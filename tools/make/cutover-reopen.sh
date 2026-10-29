#!/usr/bin/env bash
restart_services() {
  local row name uid current desired deadline=$((SECONDS+600)) remaining
  checkpoint restart started
  while read -r row; do
    name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
    current=$("${k[@]}" get deployment "$name" -o json)
    desired=$(jq --slurpfile r "$WORK/record.json" --argjson original "$row" --slurpfile cfg "$CONFIG" '
      .spec|.replicas=($original.replicas as $n|if ($cfg[0].required|index($original.name)) then ([$n,1]|max) else $n end)|
      (.template.spec.containers[],.template.spec.initContainers[]?) |=
        (if (.image|test("^ghcr.io/rhanka/radar-api[:@]")) then .image=$r[0].release.apiImage
          elif (.image|test("^ghcr.io/rhanka/radar-ui[:@]")) then .image=$r[0].release.uiImage else . end)' <<< "$current")
    patch_spec deployment "$name" "$uid" "$(jq -c .spec <<< "$current")" "$desired"
  done < <(jq -c '.deployments[]' "$WORK/record.json")
  while read -r row; do
    name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
    current=$("${k[@]}" get cronjob "$name" -o json)
    desired=$(jq --slurpfile r "$WORK/record.json" '.spec|.suspend=true|
      (.jobTemplate.spec.template.spec.containers[],.jobTemplate.spec.template.spec.initContainers[]?) |=
        (if (.image|test("^ghcr.io/rhanka/radar-api[:@]")) then .image=$r[0].release.apiImage else . end)' <<< "$current")
    patch_spec cronjob "$name" "$uid" "$(jq -c .spec <<< "$current")" "$desired"
  done < <(jq -c --slurpfile cfg "$CONFIG" '.cronjobs[]|select(.name as $n|$cfg[0].cronjobs|index($n))' "$WORK/record.json")
  while read -r name; do
    remaining=$((deadline-SECONDS)); ((remaining>0)) || fail 'Required rollouts exceeded shared deadline'
    "${k[@]}" rollout status "deployment/$name" --timeout="${remaining}s" >/dev/null || fail "Required rollout failed: $name"
  done < <(jq -r '.required[]' "$CONFIG")
  verify_required
  checkpoint restart completed
}
verify_required() {
  local name expected
  while read -r name; do
    expected=$(jq -r --arg name "$name" 'if $name=="radar-ui" then .release.uiImage else .release.apiImage end' "$WORK/record.json")
    "${k[@]}" get deployment "$name" -o json | jq -e --arg image "$expected" '
      .spec.replicas>=1 and (.status.readyReplicas//0)>=.spec.replicas
      and (.status.updatedReplicas//0)>=.spec.replicas and (.status.availableReplicas//0)>=.spec.replicas
      and .status.observedGeneration>=.metadata.generation
      and any(.spec.template.spec.containers[];.image==$image)' >/dev/null || fail "Required release not ready: $name"
    "${k[@]}" get endpoints "$name" -o json | jq -e '[.subsets[]?.addresses[]?]|length>0' >/dev/null || fail "Required endpoints missing: $name"
  done < <(jq -r '.required[]' "$CONFIG")
}
restore_routes() {
  local row current maintenance original
  while read -r row; do
    original=$(jq -c .spec <<< "$row"); maintenance=$(maintenance_spec <(printf '%s' "$original"))
    current=$("${k[@]}" get ingress "$(jq -r .name <<< "$row")" -o json)
    [[ $(jq -r .metadata.uid <<< "$current") == "$(jq -r .uid <<< "$row")" ]] || fail 'Ingress UID changed'
    # An already-restored route is legitimate only within this same recovery record.
    if jq -e --argjson original "$original" '.spec==$original' <<< "$current" >/dev/null; then continue; fi
    patch_spec ingress "$(jq -r .name <<< "$row")" "$(jq -r .uid <<< "$row")" "$maintenance" "$original" || fail 'Ingress restoration conflict'
  done < <(jq -c '.ingresses[]' "$WORK/record.json")
}
restore_schedules() {
  local row change
  while read -r row; do
    change=$(jq '[{op:"add",path:"/spec/suspend",value:(.suspend//false)}]' <<< "$row")
    if [[ $(jq -r .suspend <<< "$row") == null ]]; then
      change='[{"op":"remove","path":"/spec/suspend"}]'
    fi
    patch_uid cronjob "$(jq -r .name <<< "$row")" "$(jq -r .uid <<< "$row")" "$change"
  done < <(jq -c '.cronjobs[]' "$WORK/record.json")
}
verify_restored() {
  local row
  verify_required
  while read -r row; do
    "${k[@]}" get ingress "$(jq -r .name <<< "$row")" -o json | jq -e --argjson row "$row" \
      '.metadata.uid==$row.uid and .spec==$row.spec' >/dev/null || fail 'Ingress readback conflict'
  done < <(jq -c '.ingresses[]' "$WORK/record.json")
  while read -r row; do
    "${k[@]}" get cronjob "$(jq -r .name <<< "$row")" -o json | jq -e --argjson row "$row" \
      '.metadata.uid==$row.uid and .spec.suspend==$row.suspend' >/dev/null || fail 'Schedule readback conflict'
    if jq -e --arg n "$(jq -r .name <<< "$row")" '.cronjobs|index($n)' "$CONFIG" >/dev/null; then
      "${k[@]}" get cronjob "$(jq -r .name <<< "$row")" -o json | jq -e --slurpfile r "$WORK/record.json" '
        all(.spec.jobTemplate.spec.template.spec|.containers[]?,.initContainers[]?;
          (.image|test("^ghcr.io/rhanka/radar-api[:@]")|not) or .image==$r[0].release.apiImage)' >/dev/null || fail 'CronJob release readback conflict'
    fi
  done < <(jq -c '.cronjobs[]' "$WORK/record.json")
}
reopen() {
  checkpoint reopen started
  restore_routes
  smoke_pass "$URL" "$URL"
  restore_schedules
  verify_restored
  local job uid name
  while read -r job; do
    name=$(jq -r .name <<< "$job"); uid=$(jq -r .uid <<< "$job")
    "${k[@]}" get job "$name" -o json | jq -e --arg uid "$uid" \
      '.metadata.uid==$uid and any(.status.conditions[]?;.type=="Complete" and .status=="True")' >/dev/null || fail 'Final Job evidence is not complete'
    job_pods_ended "$name" "$uid" || fail 'An operation Job still has live consumers'
  done < <(jq -c '.jobs[]' "$WORK/record.json")
  checkpoint reopen completed
  checkpoint stage-6 completed
  # The receipt is sanitized recovery data; save it before releasing ownership.
  jq -n --arg ns "$NS" --slurpfile r "$WORK/record.json" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-cutover-receipt",namespace:$ns},data:{receipt:($r[0]|tojson)}}' > "$WORK/receipt.json"
  "${k[@]}" apply -f "$WORK/receipt.json" >/dev/null
  if "${k[@]}" get ingresses -o json | jq -e --arg s "base-maintenance-$RUN" \
    '[.items[].spec|..|objects|.service?.name? // empty]|all(.!=$s)' >/dev/null; then
    "${k[@]}" delete service "base-maintenance-$RUN" --ignore-not-found >/dev/null
  fi
  lock_delete
  printf 'SUCCESS: API, UI, MCP, routes and schedules restored (%s)\n' "$RUN"
}
