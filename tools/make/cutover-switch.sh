#!/usr/bin/env bash
# Zero-downtime release cutover: blue/green by Service selector (see README).
#   1 verify prepared stamp and slot  2 freeze (preprod)  3 switch to prepared  4 observe (drill)
#   5 promote (logs, database selection, canonical re-roll, switch back, prepared logs + delete)
#   6 finalize (CronJob images, schedules, receipt)
patch_database() {
  local from=$1 to=$2 patch
  [[ $from =~ ^radar(_next)?$ && $to =~ ^radar(_next)?$ ]] || fail 'Invalid database switch'
  patch=$(jq -n --arg from "$(printf '%s' "$from" | base64 -w0)" --arg to "$(printf '%s' "$to" | base64 -w0)" \
    '[{op:"test",path:"/data/POSTGRES_DB",value:$from},{op:"replace",path:"/data/POSTGRES_DB",value:$to}]')
  "${k[@]}" patch secret radar-db-credentials --type=json -p "$patch" >/dev/null
}
select_database() {
  # The controller cannot read the Secret: compare-and-set from the expected value,
  # else prove it is already selected. An expected CAS mismatch stays silent.
  local from=$1 to=$2
  patch_database "$from" "$to" 2> "$WORK/database-cas.err" && return
  patch_database "$to" "$to" && return
  cat "$WORK/database-cas.err" >&2
  return 1
}
record_set() {
  # record_set <jq filter> [jq args...]: update and persist the recovery record.
  local filter=$1; shift
  jq "$@" "$filter" "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
iso_ms() { date -u +%FT%T.%3NZ; }
samedb() { [[ $ENV == prod || ${SAMEDB:-0} == 1 ]]; }
slot_pods() {
  "${k[@]}" get pods -o json | jq -c --arg l "$SLOT_LABEL" --arg slot "$1" '[.items[]|
    select(.metadata.labels[$l]==$slot and (.metadata.labels["app.kubernetes.io/component"]|IN("api","mcp","ui")))|
    select(.status.phase!="Succeeded" and .status.phase!="Failed")|{name:.metadata.name,uid:.metadata.uid}]'
}
# R5: the log export Job follows every container of the recorded Pods; its streams open BEFORE
# the Pods are deleted or re-rolled and close only when each container has exited, so the
# SIGTERM drain lines are kept. Its readiness (all streams open) gates the deletion; the
# verified manifest must then list every recorded Pod.
start_pod_logs() {
  # start_pod_logs <label> <pods JSON [{name,uid}]>: sets LOG_STEP ("" when nothing to export).
  local label=$1 pods=$2 name deadline
  LOG_STEP=
  [[ $(jq length <<< "$pods") != 0 ]] || return 0
  LOG_STEP="logs${label}$(jq '[.jobs|keys[]|select(startswith("logs"))]|length' "$WORK/record.json")"
  record_set '.logPods[$step]=$pods' --arg step "$LOG_STEP" --argjson pods "$pods"
  JOB_DETACH=1 run_job "$LOG_STEP" 600 630
  name=$(jq -r --arg s "$LOG_STEP" '.jobs[$s].name' "$WORK/record.json")
  deadline=$((SECONDS+120))
  until "${k[@]}" get pods -l "job-name=$name" -o json | jq -e 'any(.items[];
      .status.phase=="Succeeded" or any(.status.conditions[]?; .type=="Ready" and .status=="True"))' >/dev/null; do
    ((SECONDS < deadline)) || fail "Log streams of $label not open; deletion refused"
    sleep 1
  done
}
finish_pod_logs() {
  # finish_pod_logs <step> [gap]: wait for the streams to close; with "gap" (recovery of a deletion
  # that already happened) an incomplete export is recorded in the receipt instead of failing.
  local step=$1 tolerate=${2:-}
  [[ -n $step ]] || return 0
  if (set -e; observe_job "$step" 630
      jq -e --slurpfile r "$WORK/record.json" --arg s "$step" '(.podUids//[]) as $done|
        all($r[0].logPods[$s][]; .uid as $u|$done|index($u))' "$WORK/verdict.json" >/dev/null); then
    record_set '.logsVerified=((.logsVerified//[])+[$s]|unique)' --arg s "$step"
    return 0
  fi
  [[ $tolerate == gap ]] || fail "Log manifest misses a recorded Pod ($step)"
  record_set '.logGaps=((.logGaps//[])+[$s]|unique)' --arg s "$step"
  printf 'Log export incomplete for %s: recorded in the receipt (logGaps)\n' "$step" >&2
}
reconcile_log_exports() {
  # Recovery: an export whose deletion already happened but whose manifest was never verified.
  local step
  for step in $(jq -r '(.logsVerified//[]) as $v|(.logGaps//[]) as $g|.logPods//{}|keys[] as $k|
      select(($v|index($k)) == null and ($g|index($k)) == null)|$k' "$WORK/record.json"); do
    finish_pod_logs "$step" gap
  done
}
prepared_stack_retire() {
  local pods
  if prepared_stack_present; then
    pods=$(slot_pods prepared) || unknown_state 'Prepared Pods state unknown; deletion refused'
    start_pod_logs prepared "$pods"
    prepared_stack_delete
    finish_pod_logs "$LOG_STEP"
  fi
  pods=$(slot_pods prepared) || unknown_state 'Prepared Pods termination unknown'
  [[ $(jq length <<< "$pods") == 0 ]] || unknown_state 'Prepared writers still running; measurement refused'
}
# Abandoned writes (preprod, conductor decision): a return to the previous database leaves the
# acknowledged writes of the abandoned one behind. They are counted (pg_stat_database written
# tuples since the baseline taken before the switch) and appended, never overwritten, to the
# entries of radar-retained-db; the next prepare refuses to replace a database with a pending
# entry. The rehearsal acknowledges its own entry only when its probe rows explain every tuple
# (ack-probe, proof attached); any other entry needs the conductor `ack`.
write_stats() {
  run_job "writestats$(jq '[.jobs|keys[]|select(startswith("writestats"))]|length' "$WORK/record.json")" 30 45
}
record_write_baseline() {
  samedb && return 0
  local at
  at=$(iso_ms)
  write_stats
  record_set '.writeBaseline=$v[0].writeStats|.writeBaselineNonProbe=$v[0].writeStatsNonProbe|.writeBaselineAt=$at' \
    --slurpfile v "$WORK/verdict.json" --arg at "$at"
}
record_abandoned() {
  # record_abandoned <abandoned database> <baseline rows, all tables> <baseline rows, non-probe tables> <baseline time>
  # (each a JSON value, null when unknown)
  local abandoned=$1 baseline=$2 nonprobe=$3 since=$4 tuples others
  # Callers first stop the abandoned database's writers. Only then wait for their delayed
  # pg_stat_user_tables counters (about 1 s, up to 10 s for an idle session) to be published.
  local settle=${STATS_SETTLE:-11}
  [[ $settle =~ ^[0-9]{1,3}$ ]] || fail 'STATS_SETTLE must be a number of seconds'
  ((settle == 0)) || sleep "$settle"
  write_stats
  local delta='.[$db] as $now|if ($base|type)!="number" or ($now|type)!="number" or $now<$base then -1 else $now-$base end'
  tuples=$(jq -r --arg db "$abandoned" --argjson base "$baseline" ".writeStats|$delta" "$WORK/verdict.json")
  others=$(jq -r --arg db "$abandoned" --argjson base "$nonprobe" ".writeStatsNonProbe|$delta" "$WORK/verdict.json")
  local entry run
  entry=$(jq -nc '{db:$db,tuples:$t,nonProbeTuples:$o,since:$since,measuredAt:$at,settledSeconds:$w}' --arg db "$abandoned" \
    --argjson t "$tuples" --argjson o "$others" --argjson since "$since" --arg at "$(iso_ms)" --argjson w "$settle")
  run=$(jq -r .run "$WORK/record.json")
  # The radar-retained-db entry is written before .abandoned: an interruption in between leaves
  # .abandoned unset, so resume measures again and the entry (one per run and database) is never
  # lost nor duplicated; the next prepare then keeps the database holding acknowledged writes.
  if ((tuples != 0)); then
    printf 'Abandoned writes on %s: %s rows, %s outside the probe table (-1 = unknown), pending acknowledgement (run %s)\n' \
      "$abandoned" "$tuples" "$others" "$run" >&2
    retained_load
    if ! jq -e --arg run "$run" --arg db "$abandoned" 'any(.data.entries//"[]"|fromjson|.[]; .run==$run and .db==$db)' \
        "$WORK/retained-now.json" >/dev/null; then
      jq --argjson e "$entry" --arg run "$run" '.data.entries=((.data.entries//"[]"|fromjson)+[$e+{run:$run,status:"pending"}]|tojson)' \
        "$WORK/retained-now.json" > "$WORK/retained-next.json"
      retained_save
    fi
  fi
  record_set '.abandoned=$e' --argjson e "$entry"
}
retained_load() {
  "${k[@]}" get configmap radar-retained-db --ignore-not-found -o json > "$WORK/retained-now.json"
  RETAINED_VERB=replace
  if [[ ! -s $WORK/retained-now.json ]]; then
    RETAINED_VERB=create
    jq -n --arg ns "$NS" '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-retained-db",namespace:$ns},data:{entries:"[]"}}' > "$WORK/retained-now.json"
  fi
}
retained_save() {
  # Compare-and-swap on the resource version: a concurrent entry is never lost.
  "${k[@]}" "$RETAINED_VERB" -f "$WORK/retained-next.json" >/dev/null || fail 'Retained database receipt changed concurrently; retry'
}
retained_gate() {
  # retained_gate <database about to be replaced>
  retained_load
  local pending
  pending=$(jq -c --arg db "$1" '[.data.entries//"[]"|fromjson|.[]|select(.status=="pending" and .db==$db)]' "$WORK/retained-now.json")
  [[ $(jq length <<< "$pending") == 0 ]] && return 0
  fail "retained_db_unacknowledged: $1 holds abandoned written tuples ($(jq -r 'map("run \(.run): \(.tuples)")|join(", ")' <<< "$pending")); review the receipt, then: make -f deploy/cutover/operator.mk ack RUN=<run> ENV=$ENV"
}
retained_mark() {
  # retained_mark <run> <acknowledgement JSON>: every pending entry of that run.
  retained_load
  jq -e --arg run "$1" 'any(.data.entries//"[]"|fromjson|.[]; .run==$run and .status=="pending")' "$WORK/retained-now.json" >/dev/null ||
    fail 'No pending retained database entry for this RUN'
  jq -r --arg run "$1" '.data.entries|fromjson|.[]|select(.run==$run and .status=="pending")|
    "Retained database \(.db): \(.tuples) abandoned written tuples since \(.since) (run \(.run))"' "$WORK/retained-now.json"
  jq --arg run "$1" --argjson ack "$2" '.data.entries=(.data.entries|fromjson|map(
    if .run==$run and .status=="pending" then .status="acknowledged"|.acknowledgement=$ack else . end)|tojson)' \
    "$WORK/retained-now.json" > "$WORK/retained-next.json"
  retained_save
}
valid_run() {
  [[ ${RUN:-} =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || fail 'RUN must identify the cutover that abandoned the writes'
}
ack_retained() {
  # Operator rollback: the conductor reviewed the receipt.
  valid_run
  retained_mark "$RUN" "$(jq -n --arg at "$(iso_ms)" '{by:"operator",at:$at}')"
  printf 'Acknowledged: the next prepare may replace it\n'
}
ack_probe() {
  # Rehearsal: acknowledged only when not a single row outside the probe table was written in the
  # abandoned database since the baseline (pg_stat_user_tables delta exactly 0).
  local entries entry original=${RUN:-}
  valid_run
  retained_load
  entries=$(jq -c --arg run "$original" '[.data.entries//"[]"|fromjson|.[]|select(.run==$run and .status=="pending")]' "$WORK/retained-now.json")
  [[ $(jq length <<< "$entries") == 1 ]] || fail 'Expected exactly one pending retained entry for this RUN'
  entry=$(jq -c '.[0]' <<< "$entries")
  jq -e '.nonProbeTuples==0' <<< "$entry" >/dev/null ||
    fail "abandoned_writes_unexplained: $(jq -r '"\(.nonProbeTuples) rows outside the probe table on \(.db) since \(.since)"' <<< "$entry"); conductor ack required"
  retained_mark "$original" "$(jq -n --arg at "$(iso_ms)" --argjson e "$entry" \
    '{by:"rehearsal-probe",at:$at,proof:{nonProbeTuples:$e.nonProbeTuples,probeTuples:$e.tuples,since:$e.since}}')"
  printf 'Rehearsal entry acknowledged: %s rows, all in the probe table\n' "$(jq -r .tuples <<< "$entry")"
}
# Drift between the live canonical workloads and what the cutover last applied (radar-applied-specs).
# Before the first promotion there is no applied record: the report is a `kubectl diff` of the
# release objects (Deployments, CronJobs, canonical Services) against the live ones. A non-empty
# report is recorded in the receipt and in radar-release-drift; production refuses
# `drift_unreviewed` until the operator acknowledges that exact report (`ack-drift`).
live_specs() {
  # Comparable specs: Deployments without replicas (HPA), CronJobs without suspend (schedules).
  local name specs='{}'
  for name in "${SLOT_SERVICES[@]}"; do
    specs=$(jq -c --argjson d "$("${k[@]}" get deployment "$name" -o json)" \
      '.["Deployment/"+$d.metadata.name]=($d.spec|del(.replicas))' <<< "$specs")
  done
  while read -r name; do
    specs=$(jq -c --argjson c "$("${k[@]}" get cronjob "$name" -o json)" \
      '.["CronJob/"+$c.metadata.name]=($c.spec|del(.suspend))' <<< "$specs")
  done < <(jq -r --slurpfile cfg "$CONFIG" '.cronjobs[]|select(.name as $n|$cfg[0].cronjobs|index($n))|.name' "$WORK/record.json")
  # The content of the nginx and generated ConfigMaps the canonical workloads mount is part of the
  # drift: an in-place edit of a mounted ConfigMap is reported too.
  local cm
  while read -r name; do
    cm=$("${k[@]}" get configmap "$name" --ignore-not-found -o json)
    [[ -n $cm ]] || cm='{"data":{"__missing__":"ConfigMap absent"}}'
    specs=$(jq -c --arg n "$name" --argjson c "$cm" '.["ConfigMap/"+$n]=($c.data//{})' <<< "$specs")
  done < <(for name in "${SLOT_SERVICES[@]}"; do "${k[@]}" get deployment "$name" -o json; done | jq -r '.spec.template.spec|
    [.volumes[]?.configMap.name,(.containers[],.initContainers[]?|.envFrom[]?.configMapRef.name)]|.[]|strings|
    select(startswith("radar-ui-nginx") or test("-[a-z0-9]{10}$"))' | sort -u)
  printf '%s\n' "$specs"
}
# Server-managed fields never enter a fingerprint: the same cluster state always hashes the same.
# spec.replicas (HPA) and spec.suspend (schedules) are operational state, not drift (live and release).
DRIFT_NORMALIZE='del(.metadata.uid,.metadata.resourceVersion,.metadata.generation,.metadata.managedFields,.metadata.creationTimestamp,.status,.spec.replicas,.spec.suspend)'
drift_report() {
  local applied key baseline
  "${k[@]}" get configmap radar-applied-specs --ignore-not-found -o json > "$WORK/applied.json"
  : > "$WORK/drift.txt"
  if [[ -s $WORK/applied.json ]]; then
    baseline=applied
    live_specs > "$WORK/live-specs.json"
    jq -r '.data.specs|fromjson|keys[]' "$WORK/applied.json" | while read -r key; do
      diff -u --label "applied $key" --label "live $key" \
        <(jq -S --arg key "$key" '.data.specs|fromjson|.[$key]' "$WORK/applied.json") \
        <(jq -S --arg key "$key" '.[$key]' "$WORK/live-specs.json") >> "$WORK/drift.txt" || true
    done
    jq -S -c --slurpfile live "$WORK/live-specs.json" '{applied:(.data.specs|fromjson),live:$live[0]}' "$WORK/applied.json" > "$WORK/drift-basis.json"
  else
    baseline=first-promotion
    release_manifests
    jq --slurpfile r "$WORK/record.json" --arg ns "$NS" '{apiVersion:"v1",kind:"List",items:[.[]|
      select(.metadata.name as $n|((.kind=="Deployment" or .kind=="Service") and (["radar-api","radar-ui","radar-immo-mcp"]|index($n)) != null)
        or (.kind=="CronJob" and ($r[0].cronjobs|map(.name)|index($n)) != null))|.metadata.namespace=$ns]}' \
      "$WORK/release-manifests.json" > "$WORK/release-objects.json"
    local code=0
    "${k[@]}" diff -f "$WORK/release-objects.json" > "$WORK/drift.txt" 2> "$WORK/drift.err" || code=$?
    ((code <= 1)) || { cat "$WORK/drift.err" >&2; fail 'Drift report unavailable (kubectl diff)'; }
    # The readable kubectl diff is attached but never hashed (temporary paths and times in its
    # headers): the fingerprint covers the normalized live and release objects.
    local kind name
    jq -c '.items[]|[.kind,.metadata.name]' "$WORK/release-objects.json" | while read -r row; do
      kind=$(jq -r '.[0]' <<< "$row"); name=$(jq -r '.[1]' <<< "$row")
      "${k[@]}" get "$(tr '[:upper:]' '[:lower:]' <<< "$kind")" "$name" --ignore-not-found -o json | jq -c "$DRIFT_NORMALIZE"
    done | jq -s . > "$WORK/live-objects.json"
    generated_configmaps_diff
    jq -S -c --slurpfile live "$WORK/live-objects.json" --slurpfile cms "$WORK/generated-cms.json" \
      "{release:[.items[]|$DRIFT_NORMALIZE],live:\$live[0],configMaps:\$cms[0]}" "$WORK/release-objects.json" > "$WORK/drift-basis.json"
  fi
  record_set '.drift={baseline:$b,lines:$n,sha256:$s}' --arg b "$baseline" --argjson n "$(wc -l < "$WORK/drift.txt")" \
    --arg s "$(sha256sum "$WORK/drift-basis.json" | cut -d' ' -f1)"
}
generated_configmaps_diff() {
  # Content of every generated (hash-suffixed) ConfigMap the release workloads mount, against the
  # ConfigMap the live workload mounts for the same role (same name before the hash suffix).
  local name pairs='[]' release live base
  : > "$WORK/generated-cms.jsonl"
  for name in "${PREPARED_NAMES[@]}"; do
    release_object Deployment "$name" > "$WORK/gen-release.json"
    "${k[@]}" get deployment "$name" -o json > "$WORK/gen-live.json"
    while read -r release; do
      base=${release%-*}
      live=$(jq -r --arg b "$base" '[.spec.template.spec|.volumes[]?.configMap.name,(.containers[]|.envFrom[]?.configMapRef.name)|strings|
        select(.==$b or startswith($b+"-"))]|first//""' "$WORK/gen-live.json")
      release_configmap "$release" | jq -c '.data//{}' > "$WORK/gen-release-data.json"
      if [[ -n $live ]]; then "${k[@]}" get configmap "$live" --ignore-not-found -o json | jq -c '.data//{}' > "$WORK/gen-live-data.json"
      else echo '{}' > "$WORK/gen-live-data.json"; fi
      [[ -s $WORK/gen-live-data.json ]] || echo '{}' > "$WORK/gen-live-data.json"
      diff -u --label "live ConfigMap/${live:-none} (mounted by $name)" --label "release ConfigMap/$release" \
        <(jq -r -S 'to_entries[]|"## \(.key)\n\(.value)"' "$WORK/gen-live-data.json") \
        <(jq -r -S 'to_entries[]|"## \(.key)\n\(.value)"' "$WORK/gen-release-data.json") >> "$WORK/drift.txt" || true
      jq -c -n --arg r "$release" --arg l "$live" --slurpfile rd "$WORK/gen-release-data.json" --slurpfile ld "$WORK/gen-live-data.json" \
        '{release:$r,live:$l,releaseData:$rd[0],liveData:$ld[0]}' >> "$WORK/generated-cms.jsonl"
    done < <(jq -r '.spec.template.spec|[.volumes[]?.configMap.name,(.containers[],.initContainers[]?|.envFrom[]?.configMapRef.name)]|
      .[]|strings|select(test("-[a-z0-9]{10}$"))' "$WORK/gen-release.json" | sort -u)
  done
  jq -s -S 'sort_by(.release)' "$WORK/generated-cms.jsonl" > "$WORK/generated-cms.json"
}
drift_gate() {
  drift_report
  jq -e '.drift.lines>0' "$WORK/record.json" >/dev/null || return 0
  local sha
  sha=$(jq -r .drift.sha256 "$WORK/record.json")
  "${k[@]}" get configmap radar-release-drift --ignore-not-found -o json > "$WORK/drift-cm.json"
  if [[ -s $WORK/drift-cm.json ]] && jq -e --arg s "$sha" '.data.sha256==$s and .data.status=="acknowledged"' "$WORK/drift-cm.json" >/dev/null; then
    record_set '.drift.acknowledged=true'
    return 0
  fi
  head -c 524288 "$WORK/drift.txt" > "$WORK/drift-report.txt"
  jq -n --arg ns "$NS" --arg s "$sha" --rawfile report "$WORK/drift-report.txt" --slurpfile r "$WORK/record.json" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-release-drift",namespace:$ns},
      data:{status:"pending",sha256:$s,run:$r[0].run,gitSha:$r[0].release.gitSha,baseline:$r[0].drift.baseline,report:$report}}' > "$WORK/drift-next.json"
  "${k[@]}" apply -f "$WORK/drift-next.json" >/dev/null
  printf 'Drift between live and %s: %s lines (radar-release-drift, sha256 %s)\n' \
    "$(jq -r .drift.baseline "$WORK/record.json")" "$(jq -r .drift.lines "$WORK/record.json")" "$sha" >&2
  [[ $ENV != prod ]] || fail "drift_unreviewed: review the report in ConfigMap radar-release-drift, then: make -f deploy/cutover/operator.mk ack-drift SHA256=$sha ENV=prod"
}
ack_drift() {
  [[ ${SHA256:-} =~ ^[a-f0-9]{64}$ ]] || fail 'SHA256 must be the reviewed drift report fingerprint'
  "${k[@]}" get configmap radar-release-drift -o json > "$WORK/drift-cm.json" || fail 'No drift report'
  jq -e --arg s "$SHA256" '.data.sha256==$s and .data.status=="pending"' "$WORK/drift-cm.json" >/dev/null ||
    fail 'No pending drift report with this SHA256 (the live state changed: run the cutover again for a new report)'
  jq -r '.data.report' "$WORK/drift-cm.json" | head -200
  "${k[@]}" patch configmap radar-release-drift --type=merge \
    -p "$(jq -n --arg at "$(iso_ms)" '{data:{status:"acknowledged",acknowledgedAt:$at}}')" >/dev/null
  printf 'Drift report %s acknowledged: the next cutover applies the release specs\n' "$SHA256"
}
record_applied_specs() {
  # After a promotion: the live canonical specs become the drift baseline.
  live_specs > "$WORK/live-specs.json"
  jq -n --arg ns "$NS" --rawfile specs "$WORK/live-specs.json" --slurpfile r "$WORK/record.json" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-applied-specs",namespace:$ns},
      data:{run:$r[0].run,gitSha:$r[0].release.gitSha,specs:$specs}}' > "$WORK/applied-next.json"
  "${k[@]}" apply -f "$WORK/applied-next.json" >/dev/null
}
served_matches() {
  # The public routes serve the expected API and UI builds.
  local result
  result=$(curl -q -sS --max-time 3 -o "$WORK/served-health" -w '%{http_code} %{content_type}' "$URL/health" 2>/dev/null) || return 1
  [[ ${result%% *} == 200 ]] && jq -e --arg sha "$1" '.sha==$sha' "$WORK/served-health" >/dev/null 2>&1 || return 1
  result=$(curl -q -sS --max-time 3 -o "$WORK/served-build" -w '%{http_code} %{content_type}' "$URL/build.json" 2>/dev/null) || return 1
  [[ ${result%% *} == 200 ]] && jq -e --arg sha "$2" '.sha==$sha' "$WORK/served-build" >/dev/null 2>&1
}
wait_served() {
  local api=$1 ui=$2 deadline=$((SECONDS+$3))
  until served_matches "$api" "$ui"; do
    ((SECONDS < deadline)) || return 1
    sleep 0.2
  done
}
switch_services() {
  # One CAS patch per Service, callers first; then every EndpointSlice on the target slot.
  local from=$1 to=$2 svc started order
  if [[ $to == prepared ]]; then order=("${SLOT_SERVICES[@]}"); else order=(radar-ui radar-immo-mcp radar-api); fi
  started=$(now_ms)
  # Any first patch can expose a writer, even when a later patch or EndpointSlice wait fails.
  record_set '.switches=((.switches//[])+[{to:$to,at:$at,mixedWindowMs:null}])' --arg to "$to" --arg at "$(iso_ms)"
  for svc in "${order[@]}"; do select_slot "$svc" "$from" "$to"; done
  for svc in "${order[@]}"; do wait_slices "$svc" "$to" 60; done
  record_set '.slot=$to|.switches[-1].mixedWindowMs=$ms' --arg to "$to" --argjson ms "$(( $(now_ms) - started ))"
  printf 'Routing on slot=%s (mixed window %s ms)\n' "$to" "$(jq -r '.switches[-1].mixedWindowMs' "$WORK/record.json")"
}
back_to_main_routing() {
  local svc routing moved=false
  for svc in "${SLOT_SERVICES[@]}"; do
    routing=$("${k[@]}" get service "$svc" -o json) || unknown_state "Service routing unknown: $svc; deletion refused"
    routing=$(jq -er --arg l "$SLOT_LABEL" '.spec.selector[$l]|select(.=="main" or .=="prepared")' <<< "$routing") ||
      unknown_state "Service routing unknown: $svc; deletion refused"
    [[ $routing != prepared ]] || moved=true
  done
  if [[ $moved == true ]]; then switch_services prepared main
  else for svc in "${SLOT_SERVICES[@]}"; do wait_slices "$svc" main 60; done; fi
}
back_to_main() {
  # Routing back first (reads and writes served by the previous release), then writes reopen.
  # The live selectors decide (a partially applied switch included), not the recorded slot.
  back_to_main_routing
  # Writes reopen at once on the previous database; the (settled) measurement of the abandoned
  # one comes after, never delaying the unfreeze.
  # freezeIntent is recorded before the freeze Job: a Job that failed or was interrupted after its
  # ALTER leaves the database read-only, so any started freeze is undone (unfreeze is idempotent).
  if jq -e '(.frozenAt!=null or .freezeIntent!=null) and .unfrozenAt==null' "$WORK/record.json" >/dev/null; then
    JOB_POLL=0.5 run_job unfreeze 60 90
    record_set '.unfrozenAt=$v[0].unfrozenAt' --slurpfile v "$WORK/verdict.json"
  fi
  # Routing and a fixed pause do not end in-flight requests. Foreground deletion waits for the
  # prepared containers to exit (including their HTTP drain) before measuring their final writes.
  prepared_stack_retire
  # Writes acknowledged by the prepared slot after the switch stay on the abandoned database.
  if ! samedb && jq -e 'any(.switches[]?; .to=="prepared") and .abandoned==null' "$WORK/record.json" >/dev/null; then
    local abandoned_db
    abandoned_db=$(jq -r .targetDb "$WORK/record.json")
    record_abandoned "$abandoned_db" "$(jq -c --arg db "$abandoned_db" '.writeBaseline[$db]' "$WORK/record.json")" \
      "$(jq -c --arg db "$abandoned_db" '.writeBaselineNonProbe[$db]' "$WORK/record.json")" "$(jq -c .writeBaselineAt "$WORK/record.json")"
  fi
}
verify_prepared_release() {
  verify_prepared
  if ! jq -e '.previousRelease!=null' "$WORK/record.json" >/dev/null; then
    cp "$WORK/record.json" "$WORK/intended-release.json"
    deployed_release
    jq --slurpfile intended "$WORK/intended-release.json" '.release as $old|
      $intended[0]|.previousRelease=$old' "$WORK/record.json" > "$WORK/next.json"
    mv "$WORK/next.json" "$WORK/record.json"; record_save
  fi
  # The document re-check lists the whole preprod bucket: before anything is switched.
  [[ $ENV != preprod ]] || run_job recon 840 900
  # Live-vs-applied drift (first promotion: live vs release); production stops on an unreviewed one.
  drift_gate
  local db matches=false
  if samedb; then db=$(jq -r .liveDb "$WORK/record.json"); else db=$(jq -r .targetDb "$WORK/record.json"); fi
  record_set '.samedb=$same|.slotDb=$db' --argjson same "$(samedb && echo true || echo false)" --arg db "$db"
  # The slot must run the release on the selected database; otherwise it is (re)started.
  # An absent slot gives no JSON at all (jq -e may then succeed): presence is checked first.
  if prepared_stack_present; then
    "${k[@]}" get deployment radar-api-prepared --ignore-not-found -o json > "$WORK/prepared-check.json" ||
      unknown_state 'Prepared slot state unknown: radar-api-prepared; deletion refused'
    if [[ -s $WORK/prepared-check.json ]] && jq -e --slurpfile r "$WORK/record.json" \
      --arg cfg "$(prepared_config_sha)" '.metadata.annotations["sentropic.io/prepared-config"]==$cfg and
      .metadata.annotations["sentropic.io/prepared-db"]==$r[0].slotDb and
      .spec.template.spec.containers[0].image==$r[0].release.apiImage' "$WORK/prepared-check.json" >/dev/null; then matches=true; fi
  fi
  if [[ $matches != true ]]; then
    prepared_stack_retire
    prepared_stack_up "$db"
  fi
  local name
  for name in "${PREPARED_NAMES[@]}"; do
    "${k[@]}" rollout status "deployment/$name-prepared" --timeout=300s >/dev/null || fail "Prepared slot not Ready: $name"
    wait_slices "$name-prepared" prepared
  done
  record_write_baseline
}
freeze_stage() {
  samedb && return 0
  jq -e '.frozenAt!=null' "$WORK/record.json" >/dev/null && return 0
  record_set '.freezeIntent=$at' --arg at "$(iso_ms)"
  JOB_POLL=0.5 run_job freeze 60 90
  record_set '.frozenAt=$v[0].frozenAt|.freezeStartedAt=$v[0].freezeStartedAt' --slurpfile v "$WORK/verdict.json"
  printf 'Live database %s read-only from %s\n' "$(jq -r .liveDb "$WORK/record.json")" "$(jq -r .frozenAt "$WORK/record.json")"
}
switch_stage() {
  switch_services main prepared
  if ! wait_served "$(jq -r .release.apiServedSha "$WORK/record.json")" "$(jq -r .release.uiServedSha "$WORK/record.json")" "${SERVE_TIMEOUT:-30}"; then
    back_to_main; fail 'Prepared slot not served after the switch; routing returned to slot=main'
  fi
  # Freeze window (owner limit 10 s): first refused write possible (ALTER) -> first green response.
  record_set 'def epochms: (sub("\\.[0-9]+Z$";"Z")|fromdateiso8601)*1000+(capture("\\.(?<ms>[0-9]+)Z$").ms|tonumber);
    .firstGreenAt=$at|if .freezeStartedAt then .freezeWindowMs=(($at|epochms)-(.freezeStartedAt|epochms)) else . end' --arg at "$(iso_ms)"
  if ! (set -e; smoke_pass "$URL" "$URL"); then
    back_to_main; fail 'Public smoke failed on the prepared slot; routing returned to slot=main'
  fi
}
observe_stage() {
  local observe=${OBSERVE:-600} end
  [[ $observe =~ ^[0-9]{1,5}$ ]] || fail 'OBSERVE must be a number of seconds'
  end=$((SECONDS+observe))
  local api ui
  api=$(jq -r .release.apiServedSha "$WORK/record.json"); ui=$(jq -r .release.uiServedSha "$WORK/record.json")
  while ((SECONDS < end)); do
    if ! wait_served "$api" "$ui" 5; then back_to_main; fail 'Prepared slot degraded during retention; routing returned to slot=main'; fi
    sleep 5
  done
  [[ ${DRILL:-0} == 1 ]] || return 0
  # Drill: routing rollback (reads on the previous release; preprod writes stay 503 while frozen), then re-switch.
  local started
  started=$(now_ms)
  switch_services prepared main
  wait_served "$(jq -r .previousRelease.apiServedSha "$WORK/record.json")" "$(jq -r .previousRelease.uiServedSha "$WORK/record.json")" 5 ||
    fail 'Drill: previous release not served within 5 s'
  record_set '.drill={backMs:$ms}' --argjson ms "$(( $(now_ms) - started ))"
  switch_services main prepared
  wait_served "$api" "$ui" 30 || { back_to_main; fail 'Drill: release not served again after the re-switch'; }
}
canonical_smoke() {
  # Canonical Pods answer directly (the Services still route to the prepared slot).
  local deadline=$((SECONDS+90)) ui api mcp
  start_forward deployment/radar-ui :8080 "$WORK/ui-forward"
  start_forward deployment/radar-api :3000 "$WORK/api-forward"
  start_forward deployment/radar-immo-mcp :8848 "$WORK/mcp-forward"
  until grep -q 'Forwarding from 127.0.0.1:' "$WORK/ui-forward" && grep -q 'Forwarding from 127.0.0.1:' "$WORK/api-forward" &&
    grep -q 'Forwarding from 127.0.0.1:' "$WORK/mcp-forward"; do
    ((SECONDS<deadline)) || fail 'Canonical forwarding unavailable'
    sleep 1
  done
  ui=http://127.0.0.1:$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/ui-forward" | head -1)
  api=http://127.0.0.1:$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/api-forward" | head -1)
  mcp=http://127.0.0.1:$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/mcp-forward" | head -1)
  http_check "$ui" / 200 html "$deadline"
  http_check "$ui" /build.json 200 build "$deadline"
  http_check "$api" /health 200 health "$deadline"
  http_check "$api" /api/v1/workspaces 401 auth "$deadline"
  http_check "$mcp" /mcp 401 bearer "$deadline"
  http_check "$mcp" /.well-known/oauth-protected-resource/mcp 200 metadata "$deadline"
  stop_forwards
}
reroll_canonical() {
  # The release manifest spec (#611) with the live selector and replica count, the release images
  # and a per-run template annotation: a new ReplicaSet even on an identical SHA.
  local name current desired
  # The generated ConfigMaps the release workloads mount exist before their specs land.
  apply_release_generated
  for name in "${SLOT_SERVICES[@]}"; do
    if ! jq -e --arg n "$name" '.promotion.oldHashes[$n]!=null' "$WORK/record.json" >/dev/null; then
      record_set '.promotion.oldHashes[$n]=$h' --arg n "$name" --arg h "$("${k[@]}" get pods -o json | jq -r --arg l "$SLOT_LABEL" --arg n "$name" '
        [.items[]|select(.metadata.labels[$l]=="main" and any(.metadata.ownerReferences[]?; .kind=="ReplicaSet" and (.name//""|startswith($n))))|
          .metadata.labels["pod-template-hash"]]|first//""')"
    fi
    current=$("${k[@]}" get deployment "$name" -o json)
    release_object Deployment "$name" > "$WORK/release-deployment.json"
    desired=$(jq --slurpfile r "$WORK/record.json" --argjson live "$current" --arg l "$SLOT_LABEL" '.spec|
      .selector=$live.spec.selector|.replicas=$live.spec.replicas|
      .template.metadata.labels=((.template.metadata.labels//{})|.[$l]="main")|
      .template.metadata.annotations=((.template.metadata.annotations//{})|.["sentropic.io/promoted-run"]=$r[0].run)|
      (.template.spec.containers[],.template.spec.initContainers[]?) |=
        (if (.image|test("^ghcr.io/rhanka/radar-api[:@]")) then .image=$r[0].release.apiImage
          elif (.image|test("^ghcr.io/rhanka/radar-ui[:@]")) then .image=$r[0].release.uiImage else . end)' "$WORK/release-deployment.json")
    patch_spec deployment "$name" "$(jq -r .metadata.uid <<< "$current")" "$(jq -c .spec <<< "$current")" "$desired"
  done
  for name in "${SLOT_SERVICES[@]}"; do
    "${k[@]}" rollout status "deployment/$name" --timeout=300s >/dev/null || fail "Canonical re-roll failed: $name"
    "${k[@]}" get pods -o json | jq -e --arg l "$SLOT_LABEL" --arg n "$name" --slurpfile r "$WORK/record.json" '
      [.items[]|select(.metadata.labels[$l]=="main" and .status.phase=="Running" and
        any(.metadata.ownerReferences[]?; .kind=="ReplicaSet" and (.name//""|startswith($n))))] as $p|
      ($p|length)>0 and all($p[]; .metadata.labels["pod-template-hash"]!=$r[0].promotion.oldHashes[$n]
        and all(.status.containerStatuses[]?; .ready))' >/dev/null || fail "No new ready ReplicaSet for $name"
  done
}
promote_stage() {
  # Order: export canonical logs, select the database, re-roll canonical, verify, route back,
  # drain, export prepared logs, delete the prepared slot.
  # The specs running before the promotion travel in the receipt: a later rollback restores them.
  if ! jq -e '.previousSpecs!=null' "$WORK/record.json" >/dev/null; then
    local spec_name specs='{}'
    for spec_name in "${SLOT_SERVICES[@]}"; do
      specs=$(jq -c --argjson d "$("${k[@]}" get deployment "$spec_name" -o json)" \
        '.["Deployment/"+$d.metadata.name]={kind:"Deployment",metadata:{name:$d.metadata.name},spec:$d.spec}' <<< "$specs")
    done
    while read -r spec_name; do
      specs=$(jq -c --argjson c "$("${k[@]}" get cronjob "$spec_name" -o json)" \
        '.["CronJob/"+$c.metadata.name]={kind:"CronJob",metadata:{name:$c.metadata.name},spec:$c.spec}' <<< "$specs")
    done < <(jq -r --slurpfile cfg "$CONFIG" '.cronjobs[]|select(.name as $n|$cfg[0].cronjobs|index($n))|.name' "$WORK/record.json")
    record_set '.previousSpecs=$s' --argjson s "$specs"
  fi
  # The canonical Pods are followed by the export from before the re-roll until they exit.
  local main_logs=
  if ! jq -e '.promotion|has("mainLogsStep")' "$WORK/record.json" >/dev/null 2>&1; then
    start_pod_logs main "$(slot_pods main)"; main_logs=$LOG_STEP
    record_set '.promotion.mainLogsStep=$s' --arg s "$main_logs"
  fi
  # Resume after an interrupted promotion: the kept export is finished and verified by
  # reconcile_log_exports below (gap-tolerant, never restarted), so main_logs stays empty here.
  if ! samedb; then
    select_database "$(jq -r .liveDb "$WORK/record.json")" "$(jq -r .targetDb "$WORK/record.json")" || fail 'Database selection failed'
    "${k[@]}" patch configmap radar-api --type=merge -p '{"data":{"GEO_DOCUMENTS_REPOINT":null}}' >/dev/null
  fi
  reroll_canonical
  finish_pod_logs "$main_logs"
  canonical_smoke
  run_job identity 30 45
  jq -e --slurpfile r "$WORK/record.json" '.database==(if $r[0].samedb then $r[0].liveDb else $r[0].targetDb end)' \
    "$WORK/verdict.json" >/dev/null || fail 'Canonical database identity mismatch'
  back_to_main_routing
  wait_served "$(jq -r .release.apiServedSha "$WORK/record.json")" "$(jq -r .release.uiServedSha "$WORK/record.json")" 30 ||
    fail 'Promoted canonical slot not served'
  drain_pause
  prepared_stack_retire
  reconcile_log_exports
  checkpoint promote completed
}
finalize_stage() {
  local row name uid current desired
  # A rollback after promotion abandons the writes made on the promoted database (resume included).
  if ! samedb && jq -e '.rollbackOf!=null and .abandoned==null' "$WORK/record.json" >/dev/null; then
    record_abandoned "$(jq -r .liveDb "$WORK/record.json")" "$(jq -c .abandonBaseline "$WORK/record.json")" \
      "$(jq -c .abandonBaselineNonProbe "$WORK/record.json")" "$(jq -c .abandonSince "$WORK/record.json")"
  fi
  while read -r row; do
    name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
    current=$("${k[@]}" get cronjob "$name" -o json)
    # The release manifest of the CronJob when the release ships one (#611), else the live spec;
    # always suspended here (restore_schedules below sets the original state).
    desired=$(jq --slurpfile r "$WORK/record.json" --argjson release "$(release_find CronJob "$name")" '
      (if $release then $release.spec else .spec end)|.suspend=true|
      (.jobTemplate.spec.template.spec.containers[],.jobTemplate.spec.template.spec.initContainers[]?) |=
        (if (.image|test("^ghcr.io/rhanka/radar-api[:@]")) then .image=$r[0].release.apiImage else . end)' <<< "$current")
    patch_spec cronjob "$name" "$uid" "$(jq -c .spec <<< "$current")" "$desired"
  done < <(jq -c --slurpfile cfg "$CONFIG" '.cronjobs[]|select(.name as $n|$cfg[0].cronjobs|index($n))' "$WORK/record.json")
  restore_schedules
  smoke_pass "$URL" "$URL"
  verify_restored
  while read -r row; do
    name=$(jq -r .name <<< "$row"); uid=$(jq -r .uid <<< "$row")
    "${k[@]}" get job "$name" -o json | jq -e --arg uid "$uid" \
      '.metadata.uid==$uid and any(.status.conditions[]?;(.type=="Complete" or .type=="Failed") and .status=="True")' >/dev/null || fail 'Final Job evidence is not terminal'
    job_pods_ended "$name" "$uid" || fail 'An operation Job still has live consumers'
  done < <(jq -c '.jobs[]' "$WORK/record.json")
  if ! samedb && [[ -z $(jq -r '.rollbackOf//""' "$WORK/record.json") ]]; then
    "${k[@]}" patch configmap radar-prepared-db --type=merge -p '{"data":{"status":"consumed"}}' >/dev/null
  fi
  record_applied_specs
  jq -n --arg ns "$NS" --slurpfile r "$WORK/record.json" \
    '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-cutover-receipt",namespace:$ns},data:{receipt:($r[0]|tojson)}}' > "$WORK/receipt.json"
  "${k[@]}" apply -f "$WORK/receipt.json" >/dev/null
  lock_delete
  printf 'SUCCESS: release %s served by slot=main without interruption (%s)\n' "$(jq -r .release.gitSha "$WORK/record.json")" "$RUN"
}
bluegreen_stages() {
  if jq -e '.checkpoints.promote!=null' "$WORK/record.json" >/dev/null; then
    execute_stage 5 Promote promote_stage
    printf '6/6 Finalize\n'; checkpoint stage-6 started; finalize_stage
    return
  fi
  if [[ ${RECOVERING:-0} == 1 ]]; then bluegreen_abandon; fi
  execute_stage 1 'Verify prepared slot' verify_prepared_release
  execute_stage 2 'Freeze live writes' freeze_stage
  execute_stage 3 'Switch to prepared slot' switch_stage
  execute_stage 4 Observe observe_stage
  checkpoint promote started
  execute_stage 5 Promote promote_stage
  # The lock is released inside finalize: no completion checkpoint after it.
  printf '6/6 Finalize\n'; checkpoint stage-6 started; finalize_stage
}
bluegreen_abandon() {
  # Before promotion: routing back to slot=main, writes reopened, schedules restored.
  back_to_main
  restore_schedules
  lock_delete
  fail 'Cutover abandoned before promotion; slot=main serves the previous release'
}
rollback_command() {
  "${k[@]}" get configmap radar-change-lock --ignore-not-found -o json > "$WORK/lock.json"
  if [[ -s $WORK/lock.json ]] && jq -e --arg run "${RUN:-}" '(.data.record|fromjson).run==$run' "$WORK/lock.json" >/dev/null; then
    lock_resume
    RECOVERING=1
    jq -e '.checkpoints.promote==null' "$WORK/record.json" >/dev/null || fail 'Promotion started: resume RUN= first, then rollback RUN='
    back_to_main
    restore_schedules
    lock_delete
    printf 'Rolled back: slot=main serves the previous release (%s)\n' "$RUN"
    return
  fi
  rollback_promoted
}
rollback_promoted() {
  # After promotion: a prepared slot is rebuilt from .previousRelease, then switched and promoted.
  local original=${RUN:-}
  "${k[@]}" get configmap radar-cutover-receipt -o json | jq -e '.data.receipt|fromjson' > "$WORK/receipt.json" || fail 'No cutover receipt'
  jq -e --arg run "$original" '.run==$run and .checkpoints.promote=="completed" and .previousRelease!=null' "$WORK/receipt.json" >/dev/null ||
    fail 'RUN is not the last promoted cutover'
  lock_acquire cutover
  jq --slurpfile x "$WORK/receipt.json" '$x[0] as $x|.mode="run"|.rollbackOf=$x.run|.releaseSpecs=$x.previousSpecs|.release=$x.previousRelease|.previousRelease=$x.release|
    .environment=$x.environment|.liveDb=(if $x.samedb then $x.liveDb else $x.targetDb end)|.targetDb=$x.liveDb' \
    "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
  SAMEDB=$(jq -r 'if .samedb then 1 else 0 end' "$WORK/receipt.json")
  inventory
  # Capacity facts for the receipt (sessions vs max_connections), as for a release run.
  run_job database 30 45
  suspend_writers drain
  record_set '.samedb=$s|.slotDb=(if $s then .liveDb else .targetDb end)' --argjson s "$( ((SAMEDB==1)) || [[ $ENV == prod ]] && echo true || echo false)"
  prepared_stack_retire
  prepared_stack_up "$(jq -r .slotDb "$WORK/record.json")"
  if ! samedb; then
    # The retained previous database was frozen by the original cutover: it accepts writes again.
    record_set '.freezeDb=.targetDb'
    JOB_POLL=0.5 run_job unfreezeprev 60 90
    record_set 'del(.freezeDb)'
    # Writes on the promoted database since the original switch are abandoned by this rollback.
    record_set '.abandonBaseline=$b|.abandonBaselineNonProbe=$o|.abandonSince=$s' --argjson b "$(jq -c --arg db "$(jq -r .liveDb "$WORK/record.json")" '.writeBaseline[$db]' "$WORK/receipt.json")" \
      --argjson o "$(jq -c --arg db "$(jq -r .liveDb "$WORK/record.json")" '.writeBaselineNonProbe[$db]' "$WORK/receipt.json")" \
      --argjson s "$(jq -c .writeBaselineAt "$WORK/receipt.json")"
    record_write_baseline
  fi
  execute_stage 2 'Freeze live writes' freeze_stage
  execute_stage 3 'Switch to prepared slot' switch_stage
  checkpoint promote started
  execute_stage 5 Promote promote_stage
  # The lock is released inside finalize: no completion checkpoint after it.
  printf '6/6 Finalize\n'; checkpoint stage-6 started; finalize_stage
}
