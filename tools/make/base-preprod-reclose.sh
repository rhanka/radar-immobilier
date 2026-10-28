#!/usr/bin/env bash
# Récupération bornée au profil API seul ou à sa fermeture déjà effectuée.
reclose-api() {
  require_expected; regular_json "${ROUTES:-}"
  maintenance_inputs; assert_cd_frozen
  assert_network; assert_refusal_service; read_ingresses
  render_api_routes
  jq -e --slurpfile c "$INPUT" --slurpfile saved "$ROUTES" --slurpfile patch "$OUTPUT/api-route-patch.json" --argjson deny "$(deny_backend)" -f tools/make/base-preprod-reclose.jq "$OUTPUT/ingresses-current.json" >/dev/null || fail 'Snapshot ou Ingress divergent avant reclose-api ; aucune mutation engagée'
  cp "$ROUTES" "$OUTPUT/reclosure-source.json"
  local ingress
  ingress=$(jq -r .apiIngress "$INPUT")
  jq -n --arg ingress "$ingress" --slurpfile saved "$ROUTES" --slurpfile live "$OUTPUT/ingresses-current.json" '
    ($live[0].items[]|select(.metadata.name==$ingress)) as $current |
    ($saved[0].closedIngresses[]|select(.metadata.name==$ingress)) as $closed |
    [{op:"test",path:"/metadata/uid",value:$current.metadata.uid},
     {op:"test",path:"/metadata/resourceVersion",value:$current.metadata.resourceVersion},
     {op:"test",path:"/spec",value:$current.spec},{op:"replace",path:"/spec",value:$closed.spec}]' > "$OUTPUT/reclose-patch.json"
  "${k[@]}" patch ingress "$ingress" --type=json --patch-file "$OUTPUT/reclose-patch.json" -o json | jq '{metadata:(.metadata|{name,uid,resourceVersion}),spec}' > "$OUTPUT/reclosed-ingress.json" || fail 'Ingress modifié pendant reclose-api ; aucun écrasement tenté'
  "${k[@]}" scale deployment/radar-api --replicas=0 > "$OUTPUT/reclose-api.txt"
  "${k[@]}" rollout status deployment/radar-api --timeout=180s >> "$OUTPUT/reclose-api.txt"
  assert_boundary; assert_closed
  # Conserver les originaux, actualiser uniquement les versions fermées relues.
  jq --slurpfile live "$OUTPUT/ingresses-current.json" '.closedIngresses=$live[0].items' "$ROUTES" > "$OUTPUT/ingress-snapshot.json"
  jq -n --slurpfile c "$INPUT" --arg at "$(date -u +%FT%TZ)" '{binding:$c[0].binding,image:$c[0].image,
    observedAt:$at,closed:true,apiReplicas:0,restorationSnapshot:"ingress-snapshot.json"}' > "$OUTPUT/reclosure.json"
  echo 'API refermée ; utiliser le snapshot actualisé pour restore-ingresses.'
}
