#!/usr/bin/env bash
# Snapshot only rollout/container identity, without environment or Secret contents.
api_identity() {
  local deployment generation observed restarted replicas uid image hash container count started image_id ready
  "${k[@]}" get deployment radar-api -o jsonpath='{.metadata.uid}{"\t"}{.metadata.generation}{"\t"}{.status.observedGeneration}{"\t"}{.spec.replicas}{"\n"}' > "$OUTPUT/api-deployment.tsv"
  IFS=$'\t' read -r deployment generation observed replicas < "$OUTPUT/api-deployment.tsv"
  restarted=$("${k[@]}" get deployment radar-api -o jsonpath='{.spec.template.metadata.annotations.kubectl\.kubernetes\.io/restartedAt}')
  [[ -n $deployment && $generation == "$observed" && $replicas == 1 ]] || fail 'API rollout identity is not stable'
  "${k[@]}" get pods -l 'app.kubernetes.io/name=radar-immobilier,app.kubernetes.io/component=api,!radar.sent-tech.ca/operator' -o jsonpath='{range .items[?(@.status.phase=="Running")]}{.metadata.uid}{"\t"}{.spec.containers[?(@.name=="api")].image}{"\t"}{.metadata.labels.pod-template-hash}{"\t"}{.status.containerStatuses[?(@.name=="api")].containerID}{"\t"}{.status.containerStatuses[?(@.name=="api")].restartCount}{"\t"}{.status.containerStatuses[?(@.name=="api")].state.running.startedAt}{"\t"}{.status.containerStatuses[?(@.name=="api")].imageID}{"\t"}{.status.containerStatuses[?(@.name=="api")].ready}{"\n"}{end}' > "$OUTPUT/api-pods.tsv"
  [[ $(wc -l < "$OUTPUT/api-pods.tsv") == 1 ]] || fail 'Exactly one running API instance required'
  IFS=$'\t' read -r uid image hash container count started image_id ready < "$OUTPUT/api-pods.tsv"
  [[ -n $uid && -n $hash && -n $container && -n $started && $count =~ ^[0-9]+$ && $ready == true
    && $image == "$(jq -r .image "$INPUT")" && ( ${image_id##*@} == "${image##*@}"
    || $image_id == "containerd://${image##*@}" || $image_id == "docker://${image##*@}" ) ]] || fail 'API container image/instance is not qualified'
  [[ -z $restarted ]] || restarted=$(utc_timestamp "$restarted" "instance.restartedAt")
  started=$(utc_timestamp "$started" "instance.startedAt")
  jq -n --arg deploymentUid "$deployment" --arg generation "$generation" --arg restartedAt "$restarted" \
    --arg podUid "$uid" --arg templateHash "$hash" --arg containerId "$container" --arg restartCount "$count" \
    --arg startedAt "$started" --arg image "$image" --arg imageID "$image_id" \
    '{deploymentUid:$deploymentUid,generation:$generation,restartedAt:$restartedAt,podUid:$podUid,
      templateHash:$templateHash,containerId:$containerId,restartCount:$restartCount,
      startedAt:$startedAt,image:$image,imageID:$imageID}' > "$OUTPUT/api-instance.json"
}
assert_api_instance() {
  api_identity
  jq -e --arg phase "$1" --slurpfile live "$OUTPUT/api-instance.json" \
    '.[$phase].instance==$live[0]' "$PROOFS" >/dev/null || fail 'API qualification predates the current restart or configuration'
}
