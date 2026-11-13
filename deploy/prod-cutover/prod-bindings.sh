#!/usr/bin/env bash
manual_configuration_snapshot() {
  "${k[@]}" get deployments -o json > "$WORK/env-deployments.json"
  jq '.items|map({name:.metadata.name,uid:.metadata.uid,containers:
    [.spec.template.spec.containers[]|{name,env,envFrom}]})' "$WORK/env-deployments.json" > "$WORK/env-snapshot.json"
  printf '[]' > "$WORK/maps-snapshot.json"
  local name
  for name in radar-api immo-mcp-config radar-mcp-receiver radar-cutover-6h; do
    "${k[@]}" get configmap "$name" --ignore-not-found -o json > "$WORK/map.json"
    if [[ -s $WORK/map.json ]]; then
      jq --slurpfile m "$WORK/map.json" '.+[$m[0]|del(.metadata.managedFields)]' "$WORK/maps-snapshot.json" > "$WORK/next.json"
      mv "$WORK/next.json" "$WORK/maps-snapshot.json"
    fi
  done
  jq --slurpfile d "$WORK/env-snapshot.json" --slurpfile m "$WORK/maps-snapshot.json" \
    '.manualEnvironments=$d[0]|.manualConfigmaps=$m[0]' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
manual_bindings() {
  local mode=$1 name current desired uid
  node deploy/prod-cutover/prod-bindings.cjs > "$WORK/bindings.json"
  if [[ $mode == candidate ]]; then
    while IFS=$'\t' read -r object key; do
      "${k[@]}" get secret "$object" -o json | jq -e --arg key "$key" \
        '.data[$key]|type=="string" and length>0' >/dev/null || fail 'Required production Secret binding missing'
    done < <(jq -r '[.[].env[].valueFrom.secretKeyRef//empty]|unique_by([.name,.key])|.[]|[.name,.key]|@tsv' "$WORK/bindings.json")
    [[ -f ${CURSOR_REFERENCE:-} && ! -L $CURSOR_REFERENCE && $CURSOR_REFERENCE != */.env* ]] \
      || fail 'Private stable cursor reference required'
    "${k[@]}" get secret radar-classification-cursor-prod -o json |
      jq -er '.data.CLASSIFICATION_CURSOR_SECRET' | base64 -d > "$WORK/cursor-reference"
    cmp -s "$CURSOR_REFERENCE" "$WORK/cursor-reference" || fail 'Classification cursor continuity mismatch'
    [[ $(base64 -d < "$WORK/cursor-reference" | wc -c) -ge 32 ]] || fail 'Classification cursor key too short'
  fi
  for name in radar-api radar-immo-mcp; do
    current=$("${k[@]}" get deployment "$name" -o json)
    uid=$(jq -er --arg n "$name" '.manualEnvironments[]|select(.name==$n)|.uid' "$WORK/record.json")
    if [[ $mode == candidate ]]; then
      desired=$(jq --slurpfile b "$WORK/bindings.json" --arg n "$name" '.spec|
        .template.spec.containers|=map(if .name==$b[0][$n].container then
          .env=((.env//[]|map(select(.name as $key|any($b[0][$n].env[];.name==$key)|not)))+$b[0][$n].env) else . end)' <<< "$current")
    else
      desired=$(jq --slurpfile r "$WORK/record.json" --arg n "$name" '.spec|
        .template.spec.containers|=map(. as $c|($r[0].manualEnvironments[]|select(.name==$n)|
        .containers[]|select(.name==$c.name)) as $o|
        (if $o.env==null then del(.env) else .env=$o.env end)|
        (if $o.envFrom==null then del(.envFrom) else .envFrom=$o.envFrom end))' <<< "$current")
    fi
    patch_spec deployment "$name" "$uid" "$(jq -c .spec <<< "$current")" "$desired"
  done
}
manual_restore_configmaps() {
  local name
  for name in radar-api immo-mcp-config radar-mcp-receiver radar-cutover-6h; do
    jq --arg n "$name" '.manualConfigmaps[]|select(.metadata.name==$n)|del(.metadata.resourceVersion,.metadata.uid)' \
      "$WORK/record.json" > "$WORK/map.json"
    if [[ -s $WORK/map.json ]]; then "${k[@]}" apply -f "$WORK/map.json" >/dev/null
    else "${k[@]}" delete configmap "$name" --ignore-not-found >/dev/null; fi
  done
}
