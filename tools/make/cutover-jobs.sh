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
      verify_closed || fail 'Consumer closure changed during database operation'
    fi
    status=$("${k[@]}" get job "$name" -o json) || fail "Job outcome unknown: $name"
    [[ $(jq -r .metadata.uid <<< "$status") == "$uid" ]] || fail "Job UID changed: $name"
    if jq -e 'any(.status.conditions[]?;.type=="Complete" and .status=="True")' <<< "$status" >/dev/null; then
      job_pods_ended "$name" "$uid" || fail "Completed Job still has consumers: $name"
      job_verdict "$name" "$uid" || fail "Missing sanitized Job verdict: $name"
      jq --arg step "$step" --slurpfile verdict "$WORK/verdict.json" \
        '.jobs[$step].outcome="completed"|.jobs[$step].verdict=$verdict[0]' "$WORK/record.json" > "$WORK/next.json"
      mv "$WORK/next.json" "$WORK/record.json"; record_save; checkpoint "$step" completed
      return
    fi
    if jq -e 'any(.status.conditions[]?;.type=="Failed" and .status=="True")' <<< "$status" >/dev/null; then
      job_pods_ended "$name" "$uid" || fail "Failed Job has live consumers: $name"
      jq --arg step "$step" '.jobs[$step].outcome="failed"' "$WORK/record.json" > "$WORK/next.json"
      mv "$WORK/next.json" "$WORK/record.json"; record_save
      fail "Job failed: $name (sanitized; inspect in cluster)"
    fi
    if ((SECONDS>=deadline)); then
      delete_job_uid "$name" "$uid"
      local termination=$((SECONDS+120))
      until job_pods_ended "$name" "$uid"; do
        ((SECONDS<termination)) || fail "Job termination unknown: $name"
        sleep 2
      done
      fail "Job deadline exceeded: $name; execution terminated"
    fi
    sleep 2
  done
}
run_job() {
  local step=$1 deadline=$2 budget=$3 name uid existing
  name="cutover-$RUN-$step"
  existing=$(jq -c --arg step "$step" '.jobs[$step]//null' "$WORK/record.json")
  if [[ ${RECOVERING:-0} == 1 && $step =~ ^(ddl|data)$ && $existing != null ]]; then
    local previous
    previous=$("${k[@]}" get job "$(jq -r .name <<< "$existing")" -o json) || fail 'Migration outcome unknown'
    if jq -e 'any(.status.conditions[]?;.type=="Failed" and .status=="True")' <<< "$previous" >/dev/null; then
      local observed_uid
      observed_uid=$(jq -r .metadata.uid <<< "$previous")
      [[ $(jq -r .uid <<< "$existing") == null || $observed_uid == "$(jq -r .uid <<< "$existing")" ]] || fail 'Failed migration UID changed'
      jq -e --arg run "$RUN" --arg hash "$(jq -r .hash <<< "$existing")" \
        '.metadata.labels["sentropic.io/bascule"]==$run and .metadata.annotations["cutover-spec-sha256"]==$hash' <<< "$previous" >/dev/null || fail 'Failed migration identity conflict'
      job_pods_ended "$(jq -r .name <<< "$existing")" "$observed_uid" || fail 'Previous migration still has consumers'
      jq --arg step "$step" --arg uid "$observed_uid" '.jobs[$step].uid=$uid|
        .jobHistory=((.jobHistory//[])+[.jobs[$step]])|del(.jobs[$step])' "$WORK/record.json" > "$WORK/next.json"
      mv "$WORK/next.json" "$WORK/record.json"; record_save
      existing=null
      name="cutover-$RUN-$(jq '.jobHistory|length' "$WORK/record.json")-$step"
    fi
  fi
  if [[ $existing != null ]]; then
    name=$(jq -r .name <<< "$existing")
    # Reconcile a create whose response/checkpoint was lost. No second restore.
    "${k[@]}" get job "$name" -o json > "$WORK/job.json" || fail "Recorded Job disappeared; outcome indeterminate: $name"
    jq -e --arg run "$RUN" --arg hash "$(jq -r .hash <<< "$existing")" \
      '.metadata.labels["sentropic.io/bascule"]==$run and .metadata.annotations["cutover-spec-sha256"]==$hash' "$WORK/job.json" >/dev/null || fail 'Recorded Job identity conflict'
    uid=$(jq -r .metadata.uid "$WORK/job.json")
    [[ $(jq -r .uid <<< "$existing") == null || $(jq -r .uid <<< "$existing") == "$uid" ]] || fail 'Recorded Job UID conflict'
  else
    render_job "$step" "$name" "$deadline"
    local hash
    hash=$(sha256sum "$WORK/job.json" | cut -d' ' -f1)
    jq --arg hash "$hash" '.metadata.annotations["cutover-spec-sha256"]=$hash' "$WORK/job.json" > "$WORK/rendered.json"
    jq --arg step "$step" --arg name "$name" --arg hash "$hash" \
      '.jobs[$step]={name:$name,uid:null,hash:$hash,outcome:"started"}' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save; checkpoint "$step" started
    "${k[@]}" create -f "$WORK/rendered.json" -o json > "$WORK/job.json" || fail "Job create outcome unknown: $name"
    uid=$(jq -r .metadata.uid "$WORK/job.json")
  fi
  jq --arg step "$step" --arg uid "$uid" '.jobs[$step].uid=$uid' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  job_observe "$step" "$name" "$uid" "$budget"
}
render_job() {
  local step=$1 name=$2 deadline=$3
  render_template "$step" > "$WORK/template.yaml"
  # Client dry-run only parses the manifest. No server mutation precedes checkpoint.
  "${k[@]}" create --dry-run=client -f "$WORK/template.yaml" -o json > "$WORK/template.json"
  if [[ $step == destination ]]; then
    jq '.spec.template.spec.containers[0].command=["node","-e",
      "const {Client}=require(\"pg\"); const c=new Client({host:process.env.POSTGRES_HOST,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB}); (async()=>{await c.connect(); const r=await c.query(\"SELECT current_database() AS name\"); if(r.rows[0].name!==process.env.CUTOVER_EXPECTED_DATABASE)throw Error(); await c.end(); console.log(JSON.stringify({ok:true}));})().catch(()=>process.exit(1));"]' \
      "$WORK/template.json" > "$WORK/identity.json"
    mv "$WORK/identity.json" "$WORK/template.json"
  fi
  jq --arg name "$name" --arg ns "$NS" --arg run "$RUN" --argjson deadline "$deadline" \
    '.metadata.name=$name|.metadata.namespace=$ns|del(.spec.ttlSecondsAfterFinished)|.spec.backoffLimit=0|
      .spec.activeDeadlineSeconds=$deadline|.metadata.labels["sentropic.io/bascule"]=$run|
      .spec.template.metadata.labels["app.kubernetes.io/name"]="radar-immobilier"|
      .spec.template.metadata.labels["sentropic.io/bascule"]=$run|
      (.spec.template.spec.containers[],.spec.template.spec.initContainers[]?)|=. ' \
    "$WORK/template.json" > "$WORK/job.json"
  sanitize_job
}
stop_operation_jobs() {
  local row name uid deadline=$((SECONDS+120))
  while read -r row; do
    name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
    [[ $uid != null ]] || {
      "${k[@]}" get job "$name" --ignore-not-found -o json > "$WORK/stop-job.json" || return 1
      [[ -s $WORK/stop-job.json ]] || continue
      jq -e --arg run "$RUN" --arg hash "$(jq -r .hash <<< "$row")" \
        '.metadata.labels["sentropic.io/bascule"]==$run and .metadata.annotations["cutover-spec-sha256"]==$hash' "$WORK/stop-job.json" >/dev/null || return 1
      uid=$(jq -r .metadata.uid "$WORK/stop-job.json")
    }
    if ! job_pods_ended "$name" "$uid"; then
      delete_job_uid "$name" "$uid"
      until job_pods_ended "$name" "$uid"; do
        ((SECONDS<deadline)) || return 1
        sleep 2
      done
    fi
  done < <(jq -c '.jobs[]' "$WORK/record.json")
}
