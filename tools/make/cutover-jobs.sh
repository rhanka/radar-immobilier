#!/usr/bin/env bash
# Jobs own all DB/S3 credentials. The controller reads status, never raw logs.
job_verdict() {
  local name=$1 uid=$2
  "${k[@]}" get pods -l "job-name=$name" -o json | jq -ce --arg uid "$uid" '
    [.items[]|select(any(.metadata.ownerReferences[]?;.kind=="Job" and .controller==true and .uid==$uid))|
      (.status.containerStatuses//[])[],(.status.initContainerStatuses//[])[]|
      .state.terminated.message? // empty|fromjson? | select(.ok==true)]|last' > "$WORK/verdict.json"
}
job_pods_ended() {
  "${k[@]}" get pods -l "job-name=$1" -o json | jq -e --arg uid "$2" '
    all(.items[]|select(any(.metadata.ownerReferences[]?;.kind=="Job" and .uid==$uid));
      .status.phase=="Succeeded" or .status.phase=="Failed")' >/dev/null
}
job_observe() {
  local step=$1 name=$2 uid=$3 budget=$4 deadline status
  deadline=$((SECONDS+budget))
  while :; do
    if jq -e '.checkpoints.close=="completed"' "$WORK/record.json" >/dev/null; then
