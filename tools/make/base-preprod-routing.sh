#!/usr/bin/env bash
# No controller extensions: public routes terminate at a selectorless Service.
maintenance_inputs() {
  jq -e '.maintenance as $m | ($m.service|test("^base-maintenance-[a-z0-9-]+$") and length<=63)
    and ($m.ingresses|length>0 and length==(unique|length) and all(.[];test("^[a-z0-9-]+$")))
    and (.apiIngress as $api | $m.ingresses|index($api)!=null)' "$INPUT" >/dev/null || fail 'Maintenance boundary inputs required'
}
read_ingresses() {
  "${k[@]}" get ingresses -o json | jq 'if any(.items[]|(.metadata.annotations//{})|to_entries[];
    (.key|test("^traefik[.]";"i")) and ((.key+" "+.value)|test("middleware|@[a-z0-9_-]+";"i")))
    then error("Traefik middleware annotations are forbidden")
    else {items:[.items[]|{metadata:(.metadata|{name,uid,resourceVersion}),spec}]} end' > "$OUTPUT/ingresses-current.json"
  jq -e --slurpfile c "$INPUT" '([.items[].metadata.name]|sort)==($c[0].maintenance.ingresses|sort)' \
    "$OUTPUT/ingresses-current.json" >/dev/null || fail 'Ingress coverage changed'
}
deny_backend() {
  jq -n --arg service "$(jq -r .maintenance.service "$INPUT")" '{service:{name:$service,port:{number:80}}}'
}
assert_boundary() {
  maintenance_inputs
  assert_network
  local service
  service=$(jq -r .maintenance.service "$INPUT")
  "${k[@]}" get service "$service" -o json > "$OUTPUT/deny-service-current.json"
  jq -e --slurpfile c "$INPUT" '.metadata.annotations["radar.sent-tech.ca/maintenance-attempt"]==$c[0].binding.maintenanceAttemptId
    and .spec.type=="ClusterIP" and ((.spec.selector//{})|length)==0
    and .spec.ports==[{name:"deny",port:80,targetPort:80,protocol:"TCP"}]' "$OUTPUT/deny-service-current.json" >/dev/null || fail 'Invalid refusal Service'
  "${k[@]}" get endpointslices -l "kubernetes.io/service-name=$service" -o json > "$OUTPUT/deny-slices.json"
  jq -e 'all(.items[]; ((.endpoints//[])|length)==0)' "$OUTPUT/deny-slices.json" >/dev/null || fail 'Refusal Service has endpoints'
  "${k[@]}" get endpoints "$service" --ignore-not-found -o json > "$OUTPUT/deny-endpoints.json"
  jq -se 'length==0 or (length==1 and ((.[0].subsets//[])|length)==0)' "$OUTPUT/deny-endpoints.json" >/dev/null || fail 'Refusal Service has legacy endpoints'
  read_ingresses
  jq -e --argjson deny "$(deny_backend)" 'all(.items[].spec;
    (if has("defaultBackend") then .defaultBackend==$deny else true end)
    and all(.rules[]?.http.paths[]?; .backend==$deny))' "$OUTPUT/ingresses-current.json" >/dev/null || fail 'Ingress lacks refusal backend'
}
close_routes() {
  read_ingresses
  jq --slurpfile c "$INPUT" '{binding:$c[0].binding,image:$c[0].image,ingresses:.items,closedIngresses:[]}' \
    "$OUTPUT/ingresses-current.json" > "$OUTPUT/ingress-snapshot.json"
  jq -n --slurpfile c "$INPUT" '{apiVersion:"v1",kind:"Service",
    metadata:{name:$c[0].maintenance.service,namespace:$c[0].namespace,
      annotations:{"radar.sent-tech.ca/maintenance-attempt":$c[0].binding.maintenanceAttemptId}},
    spec:{type:"ClusterIP",ports:[{name:"deny",port:80,targetPort:80,protocol:"TCP"}]}}' > "$OUTPUT/deny-service.json"
  "${k[@]}" create -f "$OUTPUT/deny-service.json" > "$OUTPUT/deny-create.txt"
  local ingress
  while IFS= read -r ingress; do
    jq --arg ingress "$ingress" --argjson deny "$(deny_backend)" '.ingresses[]|select(.metadata.name==$ingress)|
      [{op:"test",path:"/metadata/uid",value:.metadata.uid},
       {op:"test",path:"/metadata/resourceVersion",value:.metadata.resourceVersion},{op:"test",path:"/spec",value:.spec},
       {op:"replace",path:"/spec",value:(.spec|
        (if has("defaultBackend") then .defaultBackend=$deny else . end)|(.rules[]?.http.paths[]?.backend)=$deny)}]' \
      "$OUTPUT/ingress-snapshot.json" > "$OUTPUT/ingress-patch.json"
    "${k[@]}" patch ingress "$ingress" --type=json --patch-file "$OUTPUT/ingress-patch.json" -o json \
      | jq '{metadata:(.metadata|{name,uid,resourceVersion}),spec}' > "$OUTPUT/closed-$ingress.json" || fail 'Ingress changed during closure'
    jq --slurpfile closed "$OUTPUT/closed-$ingress.json" '.closedIngresses += $closed' \
      "$OUTPUT/ingress-snapshot.json" > "$OUTPUT/snapshot-next.json"
    mv "$OUTPUT/snapshot-next.json" "$OUTPUT/ingress-snapshot.json"
  done < <(jq -r '.maintenance.ingresses[]' "$INPUT")
  assert_boundary
}
