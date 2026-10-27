#!/usr/bin/env bash
# Explicit route rollback only while every application consumer is stopped.
restore-ingresses() {
  require_expected; regular_json "${ROUTES:-}"
  jq -e --slurpfile c "$INPUT" '.binding==$c[0].binding and .image==$c[0].image
    and ([.ingresses[].metadata.name]|sort)==($c[0].maintenance.ingresses|sort)
    and all(.ingresses[]; (.metadata.uid|type=="string" and length>0) and (.spec|type=="object"))' \
    "$ROUTES" >/dev/null || fail 'Foreign or incomplete Ingress snapshot'
  assert_closed
  jq -e --slurpfile saved "$ROUTES" '([.items[]|{name:.metadata.name,uid:.metadata.uid}]|sort_by(.name))
    ==([$saved[0].ingresses[]|{name:.metadata.name,uid:.metadata.uid}]|sort_by(.name))' \
    "$OUTPUT/ingresses-current.json" >/dev/null || fail 'Ingress identity changed before restoration'
  cp "$ROUTES" "$OUTPUT/restoration-source.json"
  local ingress
  while IFS= read -r ingress; do
    jq -n --arg ingress "$ingress" --slurpfile saved "$ROUTES" --slurpfile current "$OUTPUT/ingresses-current.json" '
      ($saved[0].ingresses[]|select(.metadata.name==$ingress)) as $s |
      ($current[0].items[]|select(.metadata.name==$ingress)) as $c |
      [{op:"test",path:"/metadata/uid",value:$s.metadata.uid},{op:"test",path:"/spec",value:$c.spec},
       {op:"replace",path:"/spec",value:$s.spec}]' > "$OUTPUT/restore-patch.json"
    "${k[@]}" patch ingress "$ingress" --type=json --patch-file "$OUTPUT/restore-patch.json" >> "$OUTPUT/restoration.txt"
  done < <(jq -r '.maintenance.ingresses[]' "$INPUT")
  read_ingresses
  jq -e --slurpfile saved "$ROUTES" '(.items|sort_by(.metadata.name))==($saved[0].ingresses|sort_by(.metadata.name))' \
    "$OUTPUT/ingresses-current.json" >/dev/null || fail 'Ingress restoration readback mismatch'
  echo 'Ingress specs restored exactly; consumers remain stopped, schedules suspended and CD frozen.'
}
