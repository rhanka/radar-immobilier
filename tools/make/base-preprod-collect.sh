#!/usr/bin/env bash
# Read only projected identities, stdout and termination metadata; never recreate a Job.
collect_job() {
  local action=$1 uid image image_id code job_uid job_image release_sha
  "${k[@]}" get job "$job" -o jsonpath='{.metadata.uid}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}' > "$OUTPUT/job-identity.tsv"
  IFS=$'\t' read -r job_uid job_image < "$OUTPUT/job-identity.tsv"
  image=$(jq -r .image "$INPUT")
  [[ -n $job_uid && $job_image == "$image" ]] || fail 'Job image identity mismatch'
  "${k[@]}" get pods -l "job-name=$job" -o jsonpath='{range .items[*]}{.metadata.uid}{"\t"}{.spec.containers[?(@.name=="operator")].image}{"\t"}{.status.containerStatuses[?(@.name=="operator")].imageID}{"\t"}{.status.containerStatuses[?(@.name=="operator")].state.terminated.exitCode}{"\n"}{end}' > "$OUTPUT/job-pods.tsv"
  [[ $(wc -l < "$OUTPUT/job-pods.tsv") == 1 ]] || fail 'Exactly one operator pod required'
  IFS=$'\t' read -r uid job_image image_id code < "$OUTPUT/job-pods.tsv"
  [[ -n $uid && $job_image == "$image" && ( ${image_id##*@} == "${image##*@}"
    || $image_id == "containerd://${image##*@}" || $image_id == "docker://${image##*@}" ) ]] || fail 'Running pod image digest mismatch'
  release_sha=$(jq -r '.binding.releaseId|split(":")[0]|split("/")[0]' "$INPUT")
  jq -n --arg image "$image" --arg imageID "$image_id" --arg podUid "$uid" --arg jobUid "$job_uid" \
    --arg releaseSha "$release_sha" '{image:$image,imageID:$imageID,podUid:$podUid,jobUid:$jobUid,releaseSha:$releaseSha}' > "$OUTPUT/execution.json"
  "${k[@]}" get pods -l "job-name=$job" -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.terminated.message}{"\n"}{end}' > "$OUTPUT/termination.json"
  "${k[@]}" logs "job/$job" -c operator > "$OUTPUT/receipt.json"
  jq -e --slurpfile c "$INPUT" --arg sha "$release_sha" \
    '.status=="complete" and .binding==$c[0].binding and .image==$c[0].image and .releaseSha==$sha' "$OUTPUT/termination.json" >/dev/null || fail 'Job has no complete bound termination receipt; evidence retained'
  [[ $(sha256sum "$OUTPUT/receipt.json" | cut -d' ' -f1) == $(jq -r .sha256 "$OUTPUT/termination.json") ]] || fail 'Receipt hash mismatch'
  jq -e --slurpfile c "$INPUT" --arg action "$action" --arg sha "$release_sha" \
    '.binding==$c[0].binding and .action==$action and .image==$c[0].image and .releaseSha==$sha
      and (.result|type=="object")' "$OUTPUT/receipt.json" >/dev/null || fail 'Receipt image/release mismatch'
  if [[ $action == init ]]; then
    jq -e --slurpfile c "$INPUT" '.result.workspaceSlug==$c[0].binding.workspaceSlug
      and (.result.workspaceId|test("^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$"))' "$OUTPUT/receipt.json" >/dev/null || fail 'Initialization receipt destination mismatch'
  fi
  [[ $code == 0 ]] || fail 'Operator Job failed; verified receipt retained'
}
wait_job() {
  local condition deadline=$((SECONDS+570))
  while (( SECONDS < deadline )); do
    condition=$("${k[@]}" get job "$job" -o jsonpath='{.status.conditions[?(@.status=="True")].type}')
    printf '%s\n' "$condition" >> "$OUTPUT/wait.txt"
    [[ $condition != *Complete* && $condition != *Failed* ]] || return 0
    sleep 2
  done
  echo 'Job did not terminate; attempt receipt collection without deleting it' >&2
  return 2
}
