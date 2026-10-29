    ($paths|map({path:.,pathType:"Prefix",backend:{service:{name:"radar-api",port:{number:3000}}}}))}}]}}' > "$OUTPUT/api-route-patch.json"
}
api_routes() {
  local ingress
  ingress=$(jq -er '.apiIngress|select(test("^[a-z0-9-]+$"))' "$INPUT")
  render_api_routes
  "${k[@]}" patch ingress "$ingress" --type=merge --patch-file "$OUTPUT/api-route-patch.json" >> "$OUTPUT/api.txt"
}
start-api() {
  # Supply the collected activation receipt, not a Job=Complete assertion.
  regular_json "${PROOFS:-}"
  jq -e --slurpfile c "$INPUT" '.binding==$c[0].binding and (.action=="activate" or .action=="resume")
    and .result.workspaceId==$c[0].binding.workspaceId and .result.sealedUnresolved==0
    and .result.status=="open-success" and .result.epoch=="scoped" and .result.maintenanceBarrier==false' "$PROOFS" >/dev/null
  assert_cd_frozen; assert_boundary
  assert_namespace_endpoints closed
  "${k[@]}" set image deployment/radar-api "api=$(jq -r .image "$INPUT")" > "$OUTPUT/api-image.txt"
  "${k[@]}" scale deployment/radar-api --replicas=1 >> "$OUTPUT/api.txt"
  "${k[@]}" rollout status deployment/radar-api --timeout=180s >> "$OUTPUT/api.txt"
  api_identity
  assert_boundary; assert_namespace_endpoints
  echo 'Public routes remain closed; use a namespace-admin tunnel and business session for Q1.'
}
tunnel-api() {
  assert_cd_frozen; assert_boundary; api_identity
  assert_namespace_endpoints
  # Local-only transport; API business-session authorization still applies.
  "${k[@]}" port-forward --address=127.0.0.1 service/radar-api 18872:3000
}
restart-api() {
  qualification_receipt
  assert_cd_frozen; assert_boundary
  assert_namespace_endpoints
  assert_api_instance q1
  cp "$OUTPUT/api-instance.json" "$OUTPUT/api-before-restart.json"
  "${k[@]}" rollout restart deployment/radar-api > "$OUTPUT/restart.txt"
  "${k[@]}" rollout status deployment/radar-api --timeout=180s >> "$OUTPUT/restart.txt"
  api_identity
  assert_boundary; assert_namespace_endpoints
  jq -n --slurpfile c "$INPUT" --slurpfile q1 "$PROOFS" --slurpfile before "$OUTPUT/api-before-restart.json" \
    --slurpfile instance "$OUTPUT/api-instance.json" --arg now "$(date -u +%FT%TZ)" \
    '{binding:$c[0].binding,image:$c[0].image,q1:$q1[0].q1,previousInstance:$before[0],
      completedAt:$now,instance:$instance[0]}' > "$OUTPUT/restart.json"
  echo 'Keep the operator boundary; qualify Q2 on the final image before reopen-api.'
}
reopen-api() {
  qualification_receipt
  jq -e '.q2.passed==true' "$PROOFS" >/dev/null
  assert_cd_frozen; assert_boundary
  assert_api_instance q2
  [[ $("${k[@]}" get deployment radar-api -o jsonpath='{.spec.template.spec.containers[0].image}') == $(jq -r .image "$INPUT") ]]
  local available
  available=$("${k[@]}" get deployment radar-api -o jsonpath='{.status.availableReplicas}')
  [[ $available =~ ^[1-9][0-9]*$ ]] || fail 'Qualified API is not available'
  # All consumers except the qualified API must remain unavailable.
  "${k[@]}" get deployments -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.replicas}{"\n"}{end}' > "$OUTPUT/final-replicas.tsv"
  awk '$1!="radar-api" && $1!="radar-postgres" && $2!=0 {exit 1}' "$OUTPUT/final-replicas.tsv"
  "${k[@]}" get cronjobs -o jsonpath='{range .items[*]}{.spec.suspend}{"\n"}{end}' > "$OUTPUT/final-cron.txt"
  if grep -vx true "$OUTPUT/final-cron.txt"; then fail 'CronJob restarted before acceptance'; fi
  "${k[@]}" get jobs -o jsonpath='{range .items[*]}{.status.active}{"\n"}{end}' > "$OUTPUT/final-jobs.txt"
  if grep -E '[1-9]' "$OUTPUT/final-jobs.txt"; then fail 'Job restarted before acceptance'; fi
  "${k[@]}" get pods -o jsonpath='{range .items[*]}{.status.phase}{"\t"}{.metadata.labels.app\.kubernetes\.io/component}{"\t"}{.spec.containers[0].image}{"\n"}{end}' > "$OUTPUT/final-pods.tsv"
  local phase component image
  while IFS=$'\t' read -r phase component image; do
    [[ $phase == Succeeded || $phase == Failed || $component == postgres
      || ( $component == api && $image == "$(jq -r .image "$INPUT")" ) ]] || fail 'Unqualified consumer restarted'
  done < "$OUTPUT/final-pods.tsv"
  assert_network; assert_namespace_endpoints
  api_routes
  echo 'API personal signals/baskets only; UI/MCP stopped, CronJobs suspended, CD frozen. Verify public paths and excluded surfaces.'
}
