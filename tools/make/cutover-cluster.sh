#!/usr/bin/env bash
# Namespace-local atomic ownership. Nothing expires by elapsed wall clock.
cluster_preflight() {
  local server
  server=$(kubectl --request-timeout=15s config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  [[ $server == "$(jq -r .server "$CONFIG")" ]] || fail 'Cluster identity mismatch'
}
executor_identity() {
  if [[ -n ${GITHUB_RUN_ID:-} ]]; then
    jq -n --arg repo "$GITHUB_REPOSITORY" --arg run "$GITHUB_RUN_ID" --arg attempt "${GITHUB_RUN_ATTEMPT:-1}" \
      --arg job "${GITHUB_JOB:-}" '{kind:"github",repo:$repo,run:$run,attempt:$attempt,job:$job,state:"running"}'
  else
    jq -n --arg host "$(hostname)" --arg boot "$(cat /proc/sys/kernel/random/boot_id)" \
      --arg pid "$$" --arg start "$(awk '{print $22}' /proc/$$/stat)" \
      '{kind:"local",host:$host,boot:$boot,pid:$pid,start:$start,state:"running"}'
  fi
}
lock_read() { "${k[@]}" get configmap radar-change-lock -o json > "$WORK/lock.json"; }
record_read() { jq -er '.data.record|fromjson' "$WORK/lock.json" > "$WORK/record.json"; }
lock_acquire() {
  RUN=$(cat /proc/sys/kernel/random/uuid)
  EXECUTOR=$(executor_identity)
  jq -n --arg run "$RUN" --arg ns "$NS" --arg kind "${1:-cutover}" --argjson executor "$EXECUTOR" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-change-lock",namespace:$ns},
      data:{record:({run:$run,kind:$kind,executor:$executor,stage:"inventory",checkpoints:{},jobs:{},originalJobs:[]}|tojson)}}' > "$WORK/lock-request.json"
  # Bounded wait (LOCK_WAIT seconds, default 900) for a competing operation to release the lock:
  # the daily restore, the staging and the release chain then queue instead of failing at once.
  # Waiting never adopts a lock: a retained recovery lock still needs `resume RUN=`.
  local deadline=$((SECONDS+${LOCK_WAIT:-900})) note=0 holder
  until "${k[@]}" create -f "$WORK/lock-request.json" >/dev/null 2>&1; do
    if "${k[@]}" get configmap radar-change-lock -o json > "$WORK/lock-held.json" 2>/dev/null; then
      holder=$(jq -r '(.data.record|fromjson).run' "$WORK/lock-held.json" 2>/dev/null || echo unknown)
      if ((SECONDS >= deadline)); then
        printf 'Change lock owned by operation %s\n' "$holder" >&2
        fail 'A competing operation holds the lock'
      fi
      ((SECONDS < note)) || { printf 'Waiting for operation %s to release radar-change-lock\n' "$holder" >&2; note=$((SECONDS+30)); }
    elif ((SECONDS >= deadline)); then fail 'Lock acquisition failed; cluster state unknown'; fi
    sleep 2
  done
  OWNED=1
  ACQUIRED=1
  lock_read; record_read
  if [[ ${1:-cutover} == writer ]]; then
    "${k[@]}" get jobs -o json > "$WORK/writer-jobs.json"
    jq --slurpfile jobs "$WORK/writer-jobs.json" '.originalJobs=[$jobs[0].items[].metadata.uid]' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
  fi
  [[ -z ${GITHUB_ENV:-} ]] || printf 'CUTOVER_LOCK_RUN=%s\n' "$RUN" >> "$GITHUB_ENV"
  printf 'Operation %s\n' "$RUN"
}
record_save() {
  # Every write compares the last read resource version and current executor.
  local current
  (( $(wc -c < "$WORK/record.json") < 750000 )) || fail 'Recovery inventory exceeds ConfigMap safety bound'
  current=$("${k[@]}" get configmap "${RECORD_MAP:-radar-change-lock}" -o json)
  jq -e --arg run "$RUN" --argjson executor "$EXECUTOR" \
    '(.data.record|fromjson)|.run==$run and .executor==$executor' <<< "$current" >/dev/null || fail 'Execution ownership changed'
  jq --slurpfile record "$WORK/record.json" '.data.record=($record[0]|tojson)' <<< "$current" > "$WORK/next-lock.json"
  "${k[@]}" replace -f "$WORK/next-lock.json" >/dev/null || fail 'Recovery record CAS conflict'
}
checkpoint() {
  jq --arg key "$1" --arg value "$2" --argjson now "$(date +%s)" '
    .stage=$key|.checkpoints[$key]=$value|
    if $value=="started" then .timings[$key].startedAt=(.timings[$key].startedAt//$now)
    elif $value=="completed" then .timings[$key].completedAt=$now|
      .timings[$key].durationSeconds=($now-(.timings[$key].startedAt//$now)) else . end' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
executor_ended() {
  local e kind pid start
  e=$(jq -c .executor "$WORK/record.json"); kind=$(jq -r .kind <<< "$e")
  [[ $(jq -r .state <<< "$e") != stopped ]] || return 0
  if [[ $kind == github ]]; then
    local repo run state attempt job
    repo=$(jq -r .repo <<< "$e"); run=$(jq -r .run <<< "$e")
    attempt=$(jq -r '.attempt//"1"' <<< "$e"); job=$(jq -r '.job//""' <<< "$e")
    [[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && $run =~ ^[0-9]+$ && $attempt =~ ^[0-9]+$ ]] || return 1
    if [[ $job =~ ^[A-Za-z0-9_-]+$ ]]; then
      # The recorded job ended (lost runner, cancellation, failure) even while a
      # later recovery job of the same run is still running.
      state=$(gh api "repos/$repo/actions/runs/$run/attempts/$attempt/jobs" --paginate \
        --jq ".jobs[]|select(.name==\"$job\")|.status" 2>/dev/null) || return 1
    else
      state=$(gh api "repos/$repo/actions/runs/$run" --jq .status 2>/dev/null) || return 1
    fi
    [[ $state == completed ]]
  elif [[ $kind == local ]]; then
    [[ $(jq -r .host <<< "$e") == "$(hostname)" ]] || return 1
    [[ $(jq -r .boot <<< "$e") == "$(cat /proc/sys/kernel/random/boot_id)" ]] || return 0
    pid=$(jq -r .pid <<< "$e"); [[ $pid =~ ^[0-9]+$ ]] || return 1
    [[ -e /proc/$pid/stat ]] || return 0
    start=$(awk '{print $22}' "/proc/$pid/stat") || return 1
    [[ $start != "$(jq -r .start <<< "$e")" ]]
  else return 1; fi
}
lock_resume() {
  [[ ${RUN:-} =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || fail 'RUN must identify the original operation'
  lock_read; record_read
  [[ $(jq -r .run "$WORK/record.json") == "$RUN" ]] || fail 'Operation ID mismatch'
  executor_ended || fail 'Recorded executor is active or cannot be proved ended'
  EXECUTOR=$(executor_identity)
  jq --argjson executor "$EXECUTOR" '.executor=$executor' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"
  jq --slurpfile r "$WORK/record.json" '.data.record=($r[0]|tojson)' "$WORK/lock.json" > "$WORK/next-lock.json"
  "${k[@]}" replace -f "$WORK/next-lock.json" >/dev/null || fail 'Takeover CAS conflict'
  OWNED=1
  ACQUIRED=1
}
lock_delete() {
  lock_read
  jq -e --arg run "$RUN" '(.data.record|fromjson).run==$run' "$WORK/lock.json" >/dev/null || fail 'Lock owner changed'
  jq '{apiVersion:"v1",kind:"DeleteOptions",preconditions:{uid:.metadata.uid,resourceVersion:.metadata.resourceVersion}}' \
    "$WORK/lock.json" > "$WORK/delete.json"
  "${k[@]}" delete --raw "/api/v1/namespaces/$NS/configmaps/radar-change-lock" -f "$WORK/delete.json" >/dev/null
  OWNED=0
}
writer_release() {
  lock_read; record_read; EXECUTOR=$(executor_identity)
  jq -e --arg run "${RUN:-}" --argjson e "$EXECUTOR" \
    '.kind=="writer" and .run==$run and .executor==$e' "$WORK/record.json" >/dev/null || fail 'Not the writer lock owner'
  # A failed/cancelled writer keeps its lock while any new unscheduled Job lives.
  "${k[@]}" get jobs -o json > "$WORK/writer-jobs.json"
  jq -e --slurpfile r "$WORK/record.json" '
    all(.items[]|select(.metadata.uid as $uid|$r[0].originalJobs|index($uid)|not)|
      select(any(.metadata.ownerReferences[]?;.controller==true and .kind=="CronJob")|not);
      any(.status.conditions[]?; (.type=="Complete" or .type=="Failed") and .status=="True"))' \
    "$WORK/writer-jobs.json" >/dev/null || fail 'Writer Jobs have not terminated; lock retained for resume'
  "${k[@]}" get pods -o json | jq -e --slurpfile r "$WORK/record.json" --slurpfile jobs "$WORK/writer-jobs.json" '
    all(.items[]|select(.status.phase!="Succeeded" and .status.phase!="Failed")|
      .metadata.ownerReferences[]?|select(.kind=="Job" and .controller==true);
      .uid as $uid|($r[0].originalJobs|index($uid))!=null and any($jobs[0].items[];.metadata.uid==$uid))' \
    >/dev/null || fail 'Writer Job Pods have not terminated; lock retained for resume'
  lock_delete
}
