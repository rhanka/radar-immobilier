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
