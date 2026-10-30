#!/usr/bin/env bash
prepared_smoke_delete() {
  [[ -f $WORK/prepared-deployment.json ]] || return 0
  local uid
  uid=$(jq -r .metadata.uid "$WORK/prepared-deployment.json")
  jq -n --arg uid "$uid" '{apiVersion:"v1",kind:"DeleteOptions",propagationPolicy:"Foreground",preconditions:{uid:$uid}}' > "$WORK/delete-prepared.json"
  "${k[@]}" delete --raw "/apis/apps/v1/namespaces/$NS/deployments/radar-api-prepared" -f "$WORK/delete-prepared.json" >/dev/null
  "${k[@]}" wait --for=delete deployment/radar-api-prepared --timeout=120s >/dev/null
  rm "$WORK/prepared-deployment.json"
}
prepared_smoke() {
  local deadline=$((SECONDS+120)) port
  "${k[@]}" get deployment radar-api -o json > "$WORK/api-template.json"
  jq --slurpfile r "$WORK/record.json" --arg ns "$NS" '
    {apiVersion:"apps/v1",kind:"Deployment",metadata:{name:"radar-api-prepared",namespace:$ns},
     spec:{replicas:1,selector:{matchLabels:{"sentropic.io/prepared":$r[0].run}},template:.spec.template}}|
    .spec.template.metadata.labels={"app.kubernetes.io/name":"radar-immobilier",
      "app.kubernetes.io/component":"api-prepared","sentropic.io/bascule":$r[0].run,"sentropic.io/prepared":$r[0].run}|
    (.spec.template.spec.containers[],.spec.template.spec.initContainers[]?) |=
      (.image=$r[0].release.apiImage|.env=((.env//[]|map(select(.name!="POSTGRES_DB")))+
        [{name:"POSTGRES_DB",value:($r[0].targetDb//$r[0].liveDb)}]))' \
    "$WORK/api-template.json" > "$WORK/prepared-deployment-template.json"
  "${k[@]}" create -f "$WORK/prepared-deployment-template.json" -o json > "$WORK/prepared-deployment.json"
  "${k[@]}" rollout status deployment/radar-api-prepared --timeout=90s >/dev/null
  start_forward deployment/radar-api-prepared :3000 "$WORK/prepared-forward"
  until grep -q 'Forwarding from 127.0.0.1:' "$WORK/prepared-forward"; do
    ((SECONDS<deadline)) || fail 'Prepared API forwarding unavailable'
    sleep 1
  done
  port=$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/prepared-forward" | head -1)
  smoke_pass "http://127.0.0.1:$port" "" "$deadline" prepared
  stop_forwards
  prepared_smoke_delete
}
