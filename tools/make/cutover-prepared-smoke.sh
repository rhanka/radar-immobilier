#!/usr/bin/env bash
# Prepared slot lifecycle: rendered by render_prepared_stack (cutover-render.sh), started after
# ddl/data/destination, kept Ready for the switch, deleted only after routing left it.
quantity_jq='def qty: tostring|if test("m$") then (.[:-1]|tonumber)/1000
  elif test("Ki$") then (.[:-2]|tonumber)*1024 elif test("Mi$") then (.[:-2]|tonumber)*1048576
  elif test("Gi$") then (.[:-2]|tonumber)*1073741824 elif test("k$") then (.[:-1]|tonumber)*1000
  elif test("M$") then (.[:-1]|tonumber)*1000000 elif test("G$") then (.[:-1]|tonumber)*1000000000
  else tonumber end;'
prepared_quota_preflight() {
  # Refuses before creating anything when any namespace ResourceQuota lacks room for the slot.
  "${k[@]}" get resourcequotas -o json > "$WORK/quotas.json"
  jq -sr "$quantity_jq"' [.[]|select(.kind=="Deployment")|.spec.replicas as $n|
      [.spec.template.spec.containers[]|.resources] as $res|
      {"limits.cpu":($n*([$res[]|.limits.cpu//0|qty]|add)),"limits.memory":($n*([$res[]|.limits.memory//0|qty]|add)),
       "requests.cpu":($n*([$res[]|.requests.cpu//0|qty]|add)),"requests.memory":($n*([$res[]|.requests.memory//0|qty]|add)),
       pods:$n}] as $parts|
    reduce $parts[] as $p ({}; reduce ($p|keys[]) as $key (.; .[$key]+=$p[$key]))' \
    "$WORK/prepared-stack.jsonl" > "$WORK/prepared-needs.json"
  jq -r --slurpfile need "$WORK/prepared-needs.json" "$quantity_jq"' .items[]|.metadata.name as $q|.status as $s|
    $need[0]|to_entries[]|select($s.hard[.key]!=null)|
    select(($s.hard[.key]|qty)-($s.used[.key]//"0"|qty) < .value)|"\($q)/\(.key)"' \
    "$WORK/quotas.json" > "$WORK/quota-short"
  [[ ! -s $WORK/quota-short ]] || fail "quota_insufficient: $(paste -sd, "$WORK/quota-short")"
}
prepared_stack_present() {
  local name
  for name in "${PREPARED_NAMES[@]}"; do
    "${k[@]}" get deployment "$name-prepared" --ignore-not-found -o name | grep -q . && return 0
  done
  return 1
}
prepared_stack_delete() {
  local name uid
  for name in "${PREPARED_NAMES[@]}"; do
    "${k[@]}" get deployment "$name-prepared" --ignore-not-found -o json > "$WORK/prepared-deployment.json"
    if [[ -s $WORK/prepared-deployment.json ]]; then
      uid=$(jq -r .metadata.uid "$WORK/prepared-deployment.json")
      jq -n --arg uid "$uid" '{apiVersion:"v1",kind:"DeleteOptions",propagationPolicy:"Foreground",preconditions:{uid:$uid}}' > "$WORK/delete-prepared.json"
      "${k[@]}" delete --raw "/apis/apps/v1/namespaces/$NS/deployments/$name-prepared" -f "$WORK/delete-prepared.json" >/dev/null
      "${k[@]}" wait --for=delete "deployment/$name-prepared" --timeout=120s >/dev/null
    fi
    "${k[@]}" delete service "$name-prepared" --ignore-not-found >/dev/null
  done
  "${k[@]}" delete configmap radar-ui-nginx-prepared --ignore-not-found >/dev/null
}
prepared_stack_up() {
  local db=$1 name row
  render_prepared_stack "$db"
  ! prepared_stack_present || fail 'Prepared slot still present; retire it (logs exported) first'
  prepared_quota_preflight
  while read -r row; do
    printf '%s' "$row" > "$WORK/prepared-object.json"
    "${k[@]}" create -f "$WORK/prepared-object.json" >/dev/null || fail 'Prepared slot creation failed'
  done < "$WORK/prepared-stack.jsonl"
  for name in "${PREPARED_NAMES[@]}"; do
    "${k[@]}" rollout status "deployment/$name-prepared" --timeout=300s >/dev/null || fail "Prepared slot not Ready: $name"
    wait_slices "$name-prepared" prepared
  done
  jq --arg db "$db" --arg at "$(date -u +%FT%TZ)" '.preparedStack={db:$db,readyAt:$at}' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
prepared_smoke() {
  # Full private smoke through the prepared UI (proxying to radar-api-prepared) and MCP.
  local deadline=$((SECONDS+120)) ui mcp
  prepared_stack_up "$(jq -r '.targetDb//.liveDb' "$WORK/record.json")"
  start_forward radar-ui-prepared :8080 "$WORK/ui-forward"
  start_forward radar-immo-mcp-prepared :8848 "$WORK/mcp-forward"
  until grep -q 'Forwarding from 127.0.0.1:' "$WORK/ui-forward" && grep -q 'Forwarding from 127.0.0.1:' "$WORK/mcp-forward"; do
    ((SECONDS<deadline)) || fail 'Prepared forwarding unavailable'
    sleep 1
  done
  ui=$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/ui-forward" | head -1)
  mcp=$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/mcp-forward" | head -1)
  smoke_pass "http://127.0.0.1:$ui" "http://127.0.0.1:$mcp" "$deadline"
  stop_forwards
}
