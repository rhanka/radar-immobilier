#!/usr/bin/env bash
network_preflight() {
  "${k[@]}" get networkpolicy allow-bascule-to-postgres -o json > "$WORK/network.json"
  jq -e '.spec.podSelector.matchLabels["app.kubernetes.io/component"]=="postgres"
    and any(.spec.ingress[]?; any(.ports[]?; .port==5432)
      and any(.from[]?; .podSelector.matchLabels["app.kubernetes.io/name"]=="radar-immobilier"
        and any(.podSelector.matchExpressions[]?; .key=="sentropic.io/bascule" and .operator=="Exists")))' \
    "$WORK/network.json" >/dev/null || fail 'Required restored PostgreSQL NetworkPolicy is absent or conflicting'
}
read_consumers() {
  "${k[@]}" get pods -o json > "$WORK/pods.json"
  "${k[@]}" get jobs -o json > "$WORK/jobs.json"
  "${k[@]}" get replicasets -o json > "$WORK/replicasets.json"
  jq --slurpfile jobs "$WORK/jobs.json" --slurpfile rs "$WORK/replicasets.json" \
    --slurpfile r "$WORK/record.json" --arg run "$RUN" -f tools/make/cutover-consumers.jq \
    "$WORK/pods.json" > "$WORK/consumers.json"
  jq -e 'all(.[];.known)' "$WORK/consumers.json" >/dev/null || {
    jq -r '.[]|select(.known|not)|"Unknown consumer: "+.name' "$WORK/consumers.json" >&2
    fail 'Unsupported consumers; no namespace-wide deletion is permitted'
  }
}
inventory() {
  network_preflight
  if jq -e '.release.dataMigration=="6h"' "$WORK/record.json" >/dev/null; then
    "${k[@]}" get configmap radar-cutover-6h -o json | jq -e '
      .data["plan.json"]|fromjson|.version==1 and (.actorSub|type=="string")
      and (.workspaceSlug|type=="string") and (.accounts|type=="array" and length>0)' \
      >/dev/null 2>&1 || fail 'Approved production-subject 6H installation plan is absent or invalid'
  fi
  "${k[@]}" get deployments -o json > "$WORK/deployments.json"
  "${k[@]}" get cronjobs -o json > "$WORK/cronjobs.json"
  "${k[@]}" get ingresses -o json > "$WORK/ingresses.json"
  "${k[@]}" get statefulsets,daemonsets,horizontalpodautoscalers -o json > "$WORK/controllers.json"
  local unsupported
  unsupported=$(jq -r -f tools/make/cutover-controllers.jq "$WORK/controllers.json")
  [[ -z $unsupported ]] || fail "Unsupported workload controller or autoscaler: $unsupported"
  "${k[@]}" api-resources --namespaced=true --verbs=list -o name > "$WORK/resource-types"
  while read -r resource; do
    if [[ $resource =~ scaledobjects|scaledjobs|verticalpodautoscalers|rollouts\. ]]; then
      "${k[@]}" get "$resource" -o json | jq -e '.items|length==0' >/dev/null || fail 'Unsupported autoscaler or rollout'
    fi
  done < "$WORK/resource-types"
  jq --slurpfile d "$WORK/deployments.json" --slurpfile c "$WORK/cronjobs.json" \
    --slurpfile i "$WORK/ingresses.json" --slurpfile cfg "$CONFIG" --arg env "$ENV" \
    -f tools/make/cutover-snapshot.jq "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"
  jq -e --slurpfile cfg "$CONFIG" '(.ingresses|length>0) and
    all($cfg[0].required[]; . as $name|any($d[0].items[]?;.metadata.name==$name))' \
    --slurpfile d "$WORK/deployments.json" "$WORK/record.json" >/dev/null || fail 'Missing required application inventory'
  jq -e '[.ingresses[].spec|..|objects|.service?.name? // empty]|all(startswith("base-maintenance-")|not)' \
    "$WORK/record.json" >/dev/null || fail 'Fresh run found an existing maintenance route; use original RUN'
  read_consumers
  jq --slurpfile p "$WORK/consumers.json" '.consumers=[$p[0][].uid]' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"
  jq -e '.release.dataMigration!="6h" or (.consumers|length>0)' "$WORK/record.json" >/dev/null || fail 'The protected 6H hook requires an observed original consumer roster'
  record_save
}
