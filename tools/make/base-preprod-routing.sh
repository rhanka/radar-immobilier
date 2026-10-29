  "${k[@]}" get endpointslices -l "kubernetes.io/service-name=$service" -o json > "$OUTPUT/deny-slices.json"
  jq -e 'all(.items[]; ((.endpoints//[])|length)==0)' "$OUTPUT/deny-slices.json" >/dev/null || fail 'Refusal Service has endpoints'
  "${k[@]}" get endpoints "$service" --ignore-not-found -o json > "$OUTPUT/deny-endpoints.json"
  jq -se 'length==0 or (length==1 and ((.[0].subsets//[])|length)==0)' "$OUTPUT/deny-endpoints.json" >/dev/null || fail 'Refusal Service has legacy endpoints'
}
assert_boundary() {
  maintenance_inputs
  assert_network
  assert_refusal_service
  read_ingresses
  jq -e --argjson deny "$(deny_backend)" 'all(.items[].spec;
    (if has("defaultBackend") then .defaultBackend==$deny else true end)
    and all(.rules[]?.http.paths[]?; .backend==$deny))' "$OUTPUT/ingresses-current.json" >/dev/null || fail 'Ingress lacks refusal backend'
}
close_routes() {
  read_ingresses
  "${k[@]}" get service "$(jq -r .maintenance.service "$INPUT")" --ignore-not-found -o json > "$OUTPUT/refusal-service-existing.json"
  jq -se 'length==0' "$OUTPUT/refusal-service-existing.json" >/dev/null || fail 'Refusal Service already exists; use reclose-api with the original ROUTES snapshot'
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
