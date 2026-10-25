#!/usr/bin/env bash
permissions() {
  local resource verb
  : > "$OUTPUT/permissions.tsv"
  for resource in deployments.apps statefulsets.apps daemonsets.apps replicasets.apps pods jobs.batch cronjobs.batch \
    ingresses.networking.k8s.io endpointslices.discovery.k8s.io services networkpolicies.networking.k8s.io; do
    for verb in get list; do
      "${k[@]}" auth can-i "$verb" "$resource" >> "$OUTPUT/permissions.tsv" || fail "Required Kubernetes permission denied: $verb $resource"
    done
  done
  for resource in deployments.apps replicasets.apps pods jobs.batch cronjobs.batch; do
    "${k[@]}" auth can-i watch "$resource" >> "$OUTPUT/permissions.tsv"
  done
  for resource in deployments.apps cronjobs.batch ingresses.networking.k8s.io; do
    "${k[@]}" auth can-i patch "$resource" >> "$OUTPUT/permissions.tsv"
  done
  for verb in get patch update; do
    "${k[@]}" auth can-i "$verb" deployments.apps --subresource=scale >> "$OUTPUT/permissions.tsv"
  done
  for verb in create delete; do "${k[@]}" auth can-i "$verb" jobs.batch >> "$OUTPUT/permissions.tsv"; done
  "${k[@]}" auth can-i create pods --subresource=exec >> "$OUTPUT/permissions.tsv"
  "${k[@]}" auth can-i get pods --subresource=log >> "$OUTPUT/permissions.tsv"
  "${k[@]}" api-resources --api-group=traefik.io -o name > "$OUTPUT/traefik-resources.txt"
  grep -qx middlewares.traefik.io "$OUTPUT/traefik-resources.txt" || fail 'Traefik middleware CRD unavailable'
  for verb in get create patch delete; do
    "${k[@]}" auth can-i "$verb" middlewares.traefik.io >> "$OUTPUT/permissions.tsv"
  done
  gh api "repos/$repo" --jq '{permissions:{push:.permissions.push,admin:.permissions.admin,maintain:.permissions.maintain}}' > "$OUTPUT/github-permissions.json"
  gh api "repos/$repo/actions/workflows/build-push-images.yml" --jq '{id,state,path}' > "$OUTPUT/workflow.json"
  gh api "repos/$repo/actions/runs?per_page=1" --jq '{total_count}' > "$OUTPUT/actions-readable.json"
  # Actions write authority is established by the explicit freeze operation, never inferred from Kubernetes.
}
inventory() {
  local resource
  for resource in deployments.apps statefulsets.apps daemonsets.apps replicasets.apps; do
    "${k[@]}" get "$resource" -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.uid}{"\t"}{.spec.replicas}{"\t"}{.spec.template.spec.containers[*].image}{"\n"}{end}' > "$OUTPUT/$resource.tsv"
  done
  "${k[@]}" get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.uid}{"\t"}{.status.phase}{"\t"}{.metadata.labels.app\.kubernetes\.io/component}{"\t"}{.spec.containers[*].image}{"\t"}{.status.containerStatuses[*].imageID}{"\n"}{end}' > "$OUTPUT/pods.tsv"
  "${k[@]}" get cronjobs.batch -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.uid}{"\t"}{.spec.suspend}{"\t"}{.spec.schedule}{"\t"}{.spec.jobTemplate.spec.template.spec.containers[*].image}{"\n"}{end}' > "$OUTPUT/cronjobs.tsv"
  "${k[@]}" get jobs.batch -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.uid}{"\t"}{.status.active}{"\t"}{.status.succeeded}{"\t"}{.spec.template.spec.containers[*].image}{"\n"}{end}' > "$OUTPUT/jobs.tsv"
  "${k[@]}" get ingresses.networking.k8s.io -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.uid}{"\t"}{.spec}{"\t"}{.metadata.annotations.traefik\.ingress\.kubernetes\.io/router\.middlewares}{"\t"}{.metadata.annotations.traefik\.ingress\.kubernetes\.io/router\.priority}{"\n"}{end}' > "$OUTPUT/routes.tsv"
  "${k[@]}" get services -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.selector}{"\t"}{.spec.publishNotReadyAddresses}{"\n"}{end}' > "$OUTPUT/services.tsv"
  "${k[@]}" get endpointslices.discovery.k8s.io -o jsonpath='{range .items[*]}{.metadata.labels.kubernetes\.io/service-name}{"\t"}{.endpoints}{"\n"}{end}' > "$OUTPUT/endpoints.tsv"
  gh api "repos/$repo/actions/workflows/build-push-images.yml" --jq '{id,state,path}' > "$OUTPUT/workflow-initial.json"
  active_runs > "$OUTPUT/runs-initial.jsonl"
  jq '{backup,binding,image}' "$INPUT" > "$OUTPUT/backup-reference.json"
  date -u +%FT%TZ > "$OUTPUT/observed-at.txt"
}
active_runs() {
  gh api --paginate "repos/$repo/actions/runs?per_page=100" \
    --jq '.workflow_runs[] | select(.status!="completed") | {id,status,head_sha,path}'
}
freeze-cd() {
  permissions
  inventory
  gh api --method PUT "repos/$repo/actions/workflows/build-push-images.yml/disable" > "$OUTPUT/freeze.txt"
  # Never change PREPROD_CD_ENABLED; disabling does not cancel existing runs.
  local run
  while IFS= read -r run; do
    gh run cancel "$run" --repo "$repo" >> "$OUTPUT/cancel.txt"
  done < <(jq -r '.cancelRuns[]? | select(type=="number")' "$INPUT")
  active_runs > "$OUTPUT/runs-after-freeze.jsonl"
  [[ ! -s $OUTPUT/runs-after-freeze.jsonl ]] || fail 'Nonterminal Actions runs remain; wait or explicitly cancel and re-inspect'
  assert_cd_frozen
}
assert_cd_frozen() {
  [[ $(gh api "repos/$repo/actions/workflows/build-push-images.yml" --jq .state) == disabled_manually ]] || fail 'CD is not frozen'
  active_runs > "$OUTPUT/runs-current.jsonl"
  [[ ! -s $OUTPUT/runs-current.jsonl ]] || fail 'A nonterminal Actions run exists'
}
maintenance_inputs() {
  jq -e '.maintenance as $m | ($m.middleware|test("^base-maintenance-[a-z0-9-]+$"))
    and ($m.sources|length>0 and all(.[];test("^[a-fA-F0-9.:]+/[0-9]+$") and .!="0.0.0.0/0" and .!="::/0"))
    and ($m.ingresses|length>0 and all(.[];test("^[a-z0-9-]+$")))' "$INPUT" >/dev/null || fail 'Maintenance boundary inputs required'
}
assert_boundary() {
  maintenance_inputs
  local ingress middleware annotation
  middleware=$(jq -r .maintenance.middleware "$INPUT")
  "${k[@]}" get middleware "$middleware" -o jsonpath='{.spec.ipAllowList.sourceRange}' > "$OUTPUT/network-sources.json"
  jq -e --slurpfile c "$INPUT" 'sort==($c[0].maintenance.sources|sort)' "$OUTPUT/network-sources.json" >/dev/null
  "${k[@]}" get ingresses -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' > "$OUTPUT/ingress-names.txt"
  jq -Rse --slurpfile c "$INPUT" '(split("\n")|map(select(length>0))|sort)==($c[0].maintenance.ingresses|sort)' "$OUTPUT/ingress-names.txt" >/dev/null || fail 'Ingress coverage changed'
  while IFS= read -r ingress; do
    annotation=$("${k[@]}" get ingress "$ingress" -o jsonpath='{.metadata.annotations.traefik\.ingress\.kubernetes\.io/router\.middlewares}')
    [[ ,$annotation, == *",radar-immobilier-preprod-$middleware@kubernetescrd,"* ]] || fail 'Ingress lacks operator boundary'
  done < "$OUTPUT/ingress-names.txt"
}
close() {
  maintenance_inputs; permissions; inventory; assert_cd_frozen
  require_expected
  # Preserve snapshots before touching replicas, schedules or routing annotations.
  jq -n --slurpfile c "$INPUT" '{apiVersion:"traefik.io/v1alpha1",kind:"Middleware",
    metadata:{name:$c[0].maintenance.middleware,namespace:$c[0].namespace},
    spec:{ipAllowList:{sourceRange:$c[0].maintenance.sources}}}' > "$OUTPUT/middleware.json"
  "${k[@]}" create -f "$OUTPUT/middleware.json" > "$OUTPUT/middleware-create.txt"
  local ingress annotation name uid replicas images suspend schedule
  while IFS= read -r ingress; do
    annotation=$("${k[@]}" get ingress "$ingress" -o jsonpath='{.metadata.annotations.traefik\.ingress\.kubernetes\.io/router\.middlewares}')
    jq -n --arg value "${annotation:+$annotation,}radar-immobilier-preprod-$(jq -r .maintenance.middleware "$INPUT")@kubernetescrd" \
      '{metadata:{annotations:{"traefik.ingress.kubernetes.io/router.middlewares":$value}}}' > "$OUTPUT/ingress-patch.json"
    "${k[@]}" patch ingress "$ingress" --type=merge --patch-file "$OUTPUT/ingress-patch.json" >> "$OUTPUT/closure.txt"
  done < <(jq -r '.maintenance.ingresses[]' "$INPUT")
  assert_boundary
  # Freeze every namespace CronJob; the initial suspend state is retained in inventory.
  while IFS=$'\t' read -r name uid suspend schedule images; do
    "${k[@]}" patch cronjob "$name" --type=merge -p '{"spec":{"suspend":true}}' >> "$OUTPUT/closure.txt"
  done < "$OUTPUT/cronjobs.tsv"
  # Only named consumer deployments; never the database. All other workloads must stop explicitly.
  while IFS=$'\t' read -r name uid replicas images; do
    [[ $name != radar-postgres ]] || continue
    "${k[@]}" scale "deployment/$name" --replicas=0 >> "$OUTPUT/closure.txt"
  done < "$OUTPUT/deployments.apps.tsv"
  echo 'Existing Jobs/external processes must finish or be explicitly stopped; collect-maintenance verifies closure.'
}
assert_closed() {
  assert_cd_frozen; assert_boundary
  local uid phase component operator
  "${k[@]}" get pods -o jsonpath='{range .items[*]}{.metadata.uid}{"\t"}{.status.phase}{"\t"}{.metadata.labels.app\.kubernetes\.io/component}{"\t"}{.metadata.labels.radar\.sent-tech\.ca/operator}{"\n"}{end}' > "$OUTPUT/pods-current.tsv"
  while IFS=$'\t' read -r uid phase component operator; do
    jq -e --arg uid "$uid" 'all(.[];.id!=$uid)' "$EXPECTED" >/dev/null || fail 'An old instance still exists'
    [[ $component == postgres || $phase == Succeeded || $phase == Failed ]] || fail 'A consumer or operator process is still running'
  done < "$OUTPUT/pods-current.tsv"
  "${k[@]}" get deployments -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.replicas}{"\n"}{end}' > "$OUTPUT/replicas-current.tsv"
  awk '$1!="radar-postgres" && $2!=0 {exit 1}' "$OUTPUT/replicas-current.tsv" || fail 'Consumer deployment can restart'
  "${k[@]}" get cronjobs -o jsonpath='{range .items[*]}{.spec.suspend}{"\n"}{end}' > "$OUTPUT/cron-current.txt"
  if grep -vx true "$OUTPUT/cron-current.txt"; then fail 'CronJob is not suspended'; fi
  "${k[@]}" get jobs -o jsonpath='{range .items[*]}{.status.active}{"\n"}{end}' > "$OUTPUT/jobs-current.txt"
  if grep -E '[1-9]' "$OUTPUT/jobs-current.txt"; then fail 'An active Job remains'; fi
  [[ $("${k[@]}" get service radar-api -o jsonpath='{.spec.publishNotReadyAddresses}') != true ]] || fail 'Service publishes unready addresses'
  "${k[@]}" get service radar-api -o jsonpath='{.spec.selector}' > "$OUTPUT/api-selector.json"
  jq -e '.["app.kubernetes.io/name"]=="radar-immobilier" and .["app.kubernetes.io/component"]=="api"' "$OUTPUT/api-selector.json" >/dev/null || fail 'Unexpected API Service selector'
  local service
  for service in radar-api radar-ui radar-immo-mcp; do
    "${k[@]}" get endpointslices -l "kubernetes.io/service-name=$service" -o jsonpath='{range .items[*]}{.endpoints}{"\n"}{end}' > "$OUTPUT/$service-endpoints.jsonl"
    jq -se 'all(.[][]; .conditions.ready==false)' "$OUTPUT/$service-endpoints.jsonl" >/dev/null || fail 'A consumer endpoint is ready'
  done
}
collect-maintenance() {
  require_expected; regular_json "${PROOFS:-}"
  # Bind declarations to the independently inventoried roster. Live checks still follow.
  jq --slurpfile c "$INPUT" --slurpfile roster "$EXPECTED" --arg now "$(date -u +%FT%TZ)" \
    '. + {evidence:($c[0].binding+{reason:$c[0].reason,instanceIds:($roster[0]|map(.id)),
      drain:{completedAt:$now,coveredInstanceIds:($roster[0]|map(.id))},
      shutdown:{completedAt:$now,coveredInstanceIds:($roster[0]|map(.id))}})}' "$PROOFS" > "$OUTPUT/qualified-input.json"
  PROOFS=$OUTPUT/qualified-input.json
  require_proofs; assert_closed; assert_mcp
  jq --slurpfile roster "$EXPECTED" '{binding,observations,evidence,databaseInspection,
    expectedInstances:$roster[0]}' "$PROOFS" > "$OUTPUT/maintenance.json"
}
assert_mcp() {
  local deployment expected actual
  deployment=$(jq -er '.mcpDeployment|select(test("^[a-z0-9-]+$"))' "$INPUT")
  expected=$(jq -r .observations.mcpSuccessor.image "$PROOFS")
  actual=$("${k[@]}" get deployment "$deployment" -o jsonpath='{.spec.template.spec.containers[0].image}')
  [[ $actual == "$expected" ]] || fail 'Successor MCP image has not been deployed'
}
qualification_receipt() {
  regular_json "${PROOFS:-}"
  { sed '$d' tools/make/base-preprod-input.jq; cat tools/make/base-preprod-acceptance.jq; } > "$OUTPUT/acceptance-filter.jq"
  jq -e --slurpfile input "$INPUT" -f "$OUTPUT/acceptance-filter.jq" "$PROOFS" >/dev/null || fail 'Bound API qualification required'
}
api_routes() {
  local ingress patchpaths
  ingress=$(jq -er '.apiIngress|select(test("^[a-z0-9-]+$"))' "$INPUT")
  patchpaths='["/health","/api/v1/auth","/api/v1/workspaces"]'
  if [[ ${1:-} == qualification ]]; then
    patchpaths='["/health","/api/v1/auth","/api/v1/workspaces","/api/graph-signals","/api/v1/signal-facets"]'
  fi
  # Keep the operator middleware attached; only the final explicit reopening removes it.
  jq -n --argjson paths "$patchpaths" '{spec:{rules:[{host:"preprod.immo.sent-tech.ca",http:{paths:
    ($paths|map({path:.,pathType:"Prefix",backend:{service:{name:"radar-api",port:{number:3000}}}}))}}]}}' > "$OUTPUT/api-route-patch.json"
  "${k[@]}" patch ingress "$ingress" --type=merge --patch-file "$OUTPUT/api-route-patch.json" >> "$OUTPUT/api.txt"
}
start-api() {
  # Supply the collected activation receipt, not a Job=Complete assertion.
  regular_json "${PROOFS:-}"
  jq -e --slurpfile c "$INPUT" '.binding==$c[0].binding and (.action=="activate" or .action=="resume")
    and .result.status=="open-success" and .result.epoch=="scoped" and .result.maintenanceBarrier==false' "$PROOFS" >/dev/null
  assert_cd_frozen; assert_boundary
  api_routes qualification
  "${k[@]}" set image deployment/radar-api "api=$(jq -r .image "$INPUT")" > "$OUTPUT/api-image.txt"
  "${k[@]}" scale deployment/radar-api --replicas=1 >> "$OUTPUT/api.txt"
  "${k[@]}" rollout status deployment/radar-api --timeout=180s >> "$OUTPUT/api.txt"
  echo 'Keep the operator boundary; qualify Q1 before restart-api.'
}
restart-api() {
  qualification_receipt
  assert_cd_frozen; assert_boundary
  "${k[@]}" rollout restart deployment/radar-api > "$OUTPUT/restart.txt"
  "${k[@]}" rollout status deployment/radar-api --timeout=180s >> "$OUTPUT/restart.txt"
  echo 'Keep the operator boundary; qualify Q2 on the final image before reopen-api.'
}
reopen-api() {
  qualification_receipt
  jq -e '.q2.passed==true' "$PROOFS" >/dev/null
  assert_cd_frozen; assert_boundary
  [[ $("${k[@]}" get deployment radar-api -o jsonpath='{.spec.template.spec.containers[0].image}') == $(jq -r .image "$INPUT") ]]
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
  api_routes
  local ingress annotation middleware
  ingress=$(jq -r .apiIngress "$INPUT")
  middleware="radar-immobilier-preprod-$(jq -r .maintenance.middleware "$INPUT")@kubernetescrd"
  annotation=$("${k[@]}" get ingress "$ingress" -o jsonpath='{.metadata.annotations.traefik\.ingress\.kubernetes\.io/router\.middlewares}')
  jq -n --arg a "$annotation" --arg m "$middleware" '{metadata:{annotations:{
    "traefik.ingress.kubernetes.io/router.middlewares":($a|split(",")|map(select(.!=$m))|join(","))}}}' > "$OUTPUT/reopen-patch.json"
  "${k[@]}" patch ingress "$ingress" --type=merge --patch-file "$OUTPUT/reopen-patch.json" >> "$OUTPUT/api.txt"
  echo 'API personal signals/baskets only; UI/MCP stopped, CronJobs suspended, CD frozen. Verify public paths and excluded surfaces.'
}
