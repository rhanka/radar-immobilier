#!/usr/bin/env bash
# Read-only qualification: never install or rewrite cluster networking.
network_inventory() {
  local resource
  "${k[@]}" get services -o json > "$OUTPUT/network-services.json"
  "${k[@]}" get networkpolicies -o json > "$OUTPUT/network-policies.json"
  "${k[@]}" get endpointslices -o json > "$OUTPUT/network-slices.json"
  "${k[@]}" get endpoints -o json > "$OUTPUT/network-endpoints.json"
  "${k[@]}" get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.uid}{"\t"}{.metadata.labels.app\.kubernetes\.io/component}{"\t"}{.spec.containers[*].image}{"\t"}{.spec.hostNetwork}{"\t"}{.spec.containers[*].ports[*].hostPort}{"\t"}{.spec.initContainers[*].ports[*].hostPort}{"\n"}{end}' > "$OUTPUT/network-pods.tsv"
  "${k[@]}" get deployments,statefulsets,daemonsets,jobs -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.hostNetwork}{"\t"}{.spec.template.spec.containers[*].ports[*].hostPort}{"\t"}{.spec.template.spec.initContainers[*].ports[*].hostPort}{"\n"}{end}' > "$OUTPUT/network-templates.tsv"
  "${k[@]}" get cronjobs -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.jobTemplate.spec.template.spec.hostNetwork}{"\t"}{.spec.jobTemplate.spec.template.spec.containers[*].ports[*].hostPort}{"\t"}{.spec.jobTemplate.spec.template.spec.initContainers[*].ports[*].hostPort}{"\n"}{end}' >> "$OUTPUT/network-templates.tsv"
  "${k[@]}" api-resources --namespaced=true --verbs=list -o name > "$OUTPUT/network-resource-types.txt"
  while IFS= read -r resource; do
    [[ $resource =~ ^[a-z0-9.-]+$ ]] || fail 'Invalid network resource discovery'
    case $resource in ingresses.networking.k8s.io|networkpolicies.networking.k8s.io) continue;; esac
    if [[ $resource =~ ingress|gateway|route|proxy|virtualservice|virtualserver|transportserver|networkpolic|serviceimport|serviceexport ]]; then
      "${k[@]}" get "$resource" -o json | jq '{items:[.items[]|{name:.metadata.name,uid:.metadata.uid}]}' > "$OUTPUT/network-$resource.json"
      jq -e '.items|length==0' "$OUTPUT/network-$resource.json" >/dev/null || fail "Unsupported alternate network route/policy: $resource"
    fi
  done < "$OUTPUT/network-resource-types.txt"
}
assert_network() {
  network_inventory
  jq -e 'all(.items[].spec; .type=="ClusterIP" and ((.externalIPs//[])|length)==0
    and .externalName==null and .loadBalancerIP==null and .publishNotReadyAddresses!=true
    and all(.ports[]?; (.nodePort//0)==0))' "$OUTPUT/network-services.json" >/dev/null || fail 'Unqualified Service exposure (type, external address, nodePort or unready publishing)'
  awk -F '\t' '$5=="true" || $6~/[1-9]/ || $7~/[1-9]/ {exit 1}' "$OUTPUT/network-pods.tsv" || fail 'Pod exposes hostNetwork or hostPort'
  awk -F '\t' '$2=="true" || $3~/[1-9]/ || $4~/[1-9]/ {exit 1}' "$OUTPUT/network-templates.tsv" || fail 'Workload template exposes hostNetwork or hostPort'
  # Default deny covers future pods. Additive grants may admit only the
  # known ingress controller, or target database pods exclusively.
  jq -e 'any(.items[].spec; .podSelector=={} and (.policyTypes|index("Ingress"))!=null and ((.ingress//[])|length)==0)
    and all(.items[].spec;
      .podSelector.matchLabels["app.kubernetes.io/component"]=="postgres"
      or all(.ingress[]?; (.from|length)>0 and all(.from[];
        (keys|sort)==["namespaceSelector","podSelector"]
        and .podSelector=={matchLabels:{"app.kubernetes.io/name":"traefik"}}
        and (.namespaceSelector=={matchLabels:{"kubernetes.io/metadata.name":"traefik"}}
          or .namespaceSelector=={matchLabels:{"kubernetes.io/metadata.name":"kube-system"}}))))' \
    "$OUTPUT/network-policies.json" >/dev/null || fail 'Consumer pod ingress is not isolated by supported NetworkPolicies'
  local policies
  policies=$(jq -Sc '[.items[]|{metadata:(.metadata|{name,uid,resourceVersion}),spec}]|sort_by(.metadata.name)' "$OUTPUT/network-policies.json" | sha256sum | cut -d' ' -f1)
  printf '%s\n' "$policies" > "$OUTPUT/network-policies.sha256"
  jq '.maintenance.networkIsolation' "$INPUT" > "$OUTPUT/network-isolation-receipt.json"
  { sed '$d' tools/make/base-preprod-input.jq; cat <<'JQ'
. as $c | .maintenance.networkIsolation as $p | $p|attestation and .passed==true
  and .binding==$c.binding and .image==$c.image and .context==$c.context and .namespace==$c.namespace
  and .policySha256==$policies and .networkPolicyEnforced==true
  and .podIPDenied==true and .serviceIPDenied==true and .nodeOriginDenied==true
JQ
  } > "$OUTPUT/network-proof.jq"
  jq -e --arg policies "$policies" -f "$OUTPUT/network-proof.jq" "$INPUT" >/dev/null \
    || fail 'Fresh bound CNI enforcement probes required; direct pod access is unverified'
}
assert_namespace_endpoints() {
  # API endpoints are admitted only after activation, under the verified pod boundary.
  jq -Rn --arg image "$(jq -r .image "$INPUT")" --arg phase "${1:-qualification}" '[inputs|split("\t")|
    select((.[2]=="postgres" and (.[0]|startswith("radar-postgres-")))
      or ($phase=="qualification" and .[2]=="api" and .[3]==$image))|{name:.[0],uid:.[1]}]' \
    "$OUTPUT/network-pods.tsv" > "$OUTPUT/network-allowed-pods.json"
  jq -e --slurpfile allowed "$OUTPUT/network-allowed-pods.json" '
    all(.items[].endpoints[]?; .conditions.ready==false or
      (.targetRef as $p|$p.kind=="Pod" and any($allowed[0][];.name==$p.name and .uid==$p.uid)))' \
    "$OUTPUT/network-slices.json" >/dev/null || fail 'A consumer endpoint is ready outside the qualified roster'
  jq -e --slurpfile allowed "$OUTPUT/network-allowed-pods.json" '
    all(.items[].subsets[]?.addresses[]?; .targetRef as $p|
      $p.kind=="Pod" and any($allowed[0][];.name==$p.name and .uid==$p.uid))' \
    "$OUTPUT/network-endpoints.json" >/dev/null || fail 'A consumer legacy endpoint is ready outside the qualified roster'
}
