#!/usr/bin/env bash
permissions() {
  local resource verb
  : > "$OUTPUT/permissions.tsv"
  for resource in deployments.apps replicasets.apps pods jobs.batch cronjobs.batch \
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
