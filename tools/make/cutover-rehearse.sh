#!/usr/bin/env bash
# Preprod CI/CD rehearsal and release of the zero-downtime cutover (R3). Once the slots are
# adopted, deploy-preprod no longer rolls the canonical slot: this rehearsal IS the preprod
# release, from the previous release to the new one, every scenario under the read and writer
# probes and judged by probe-verify.mjs:
#   preprod  OBSERVE=120 DRILL=1   previous -> new: freeze, prepared database, routing drill;
#   rollback  rollback RUN=<preprod>  new -> previous after promotion (unfreeze of the retained DB);
#   repromote rollback RUN=<rollback> previous -> new again (rollback of the rollback);
#   samedb   SAMEDB=1 OBSERVE=60   new on the (now migrated) live database: the production path.
# Plus the restore criterion of the prepared stamp (restorePath=clone, restoreSeconds<=300) and
# the post-run state (no prepared slot left, no log gap, sessions <= 80 % of max_connections).
set -euo pipefail
[[ ${ENV:-} == preprod ]] || { echo 'Rehearsal is preprod-only' >&2; exit 2; }
[[ -n ${RELEASE:-} ]] || { echo 'RELEASE=<release.json> is required' >&2; exit 2; }
CONFIG=deploy/cutover/config.json
URL=$(jq -r .preprod.url "$CONFIG")
NS=$(jq -r .preprod.namespace "$CONFIG")
k() { kubectl --request-timeout=15s -n "$NS" "$@"; }
prepared_slot_gone() {
  local deployment
  deployment=$(k get deployment radar-api-prepared --ignore-not-found -o name) || return 1
  [[ -z $deployment ]]
}
if [[ ${1:-} == check ]]; then
  # CI guard, run in prepare-preprod-db before any clone: "skip" only when the release is already
  # served (a re-run of the same main workflow) AND the rehearsal of that SHA was green
  # (radar-rehearsal-receipt); "run" otherwise, so a red rehearsal is always replayed in full.
  served=$(mktemp)
  code=$(curl -q -sS --max-time 15 -o "$served" -w '%{http_code}' "$URL/health" 2>/dev/null || echo 000)
  state=run
  receipt=$(k get configmap radar-rehearsal-receipt --ignore-not-found -o json 2>/dev/null || true)
  if [[ ${code%% *} == 200 && -n $receipt ]] && jq -e --slurpfile r "$RELEASE" '.sha==$r[0].gitSha' "$served" >/dev/null 2>&1 &&
    jq -e --slurpfile r "$RELEASE" '.data.gitSha==$r[0].gitSha and .data.status=="green"' <<< "$receipt" >/dev/null 2>&1; then state=skip; fi
  rm -f "$served"
  echo "$state"
  exit 0
fi
[[ ${#CUTOVER_PROBE_TOKEN} -ge 32 ]] || { echo 'CUTOVER_PROBE_TOKEN (32+ characters) is required' >&2; exit 2; }
OUT=${OUTPUT:-.bascule-work/rehearsal}
mkdir -p "$OUT"
red=0
verdict() { printf '%s\n' "$*" | tee -a "$OUT/verdict.txt"; }
rehearsal_receipt() {
  # The verdict of this SHA: a later re-run is skipped only after a green one. The previous release
  # (and its specs) that the first scenario switched from is kept, so that a re-run after a red
  # rehearsal can replay from it.
  local from='{}'
  if [[ -s $OUT/preprod-receipt.json ]] && jq -e --slurpfile r "$RELEASE" '.previousRelease.gitSha != $r[0].gitSha' "$OUT/preprod-receipt.json" >/dev/null 2>&1; then
    from=$(jq -c '{previousRelease:(.previousRelease|tojson),previousSpecs:(.previousSpecs|tojson)}' "$OUT/preprod-receipt.json")
  elif [[ -n ${REPLAY_FROM:-} ]]; then from=$REPLAY_FROM; fi
  jq -n --arg ns "$NS" --arg status "$1" --slurpfile r "$RELEASE" --arg at "$(date -u +%FT%TZ)" --rawfile v "$OUT/verdict.txt" \
    --argjson from "$from" '{apiVersion:"v1",kind:"ConfigMap",metadata:{name:"radar-rehearsal-receipt",namespace:$ns},
      data:({gitSha:$r[0].gitSha,status:$status,at:$at,verdict:$v}+$from)}' > "$OUT/rehearsal-receipt.json"
  k apply -f "$OUT/rehearsal-receipt.json" >/dev/null || echo 'rehearsal receipt not recorded: the next re-run replays the rehearsal' >&2
}
: > "$OUT/verdict.txt"
# Every probe run of this rehearsal shares one prefix (traceable in cutover_probe_writes).
CHAIN="rh-$(date -u +%s)"
# A pending retained-database entry is never overwritten: one that the conductor has not
# acknowledged (operator rollback) stops the rehearsal cleanly before any change.
pending=$(k get configmap radar-retained-db --ignore-not-found -o json | jq -c '[.data.entries//"[]"|fromjson|.[]|select(.status=="pending")]' 2>/dev/null || echo '[]')
if [[ $(jq length <<< "${pending:-[]}") != 0 ]]; then
  verdict "retained database: RED pending entries need the conductor ack first: $pending"; rehearsal_receipt red; exit 1
fi
stamp=$(k get configmap radar-prepared-db -o json | jq -c .data)
printf '%s\n' "$stamp" | jq '{status,restorePath,restoreSeconds,targetDb,gitSha}' > "$OUT/prepared-stamp.json"
if jq -e '.restorePath=="clone" and (.restoreSeconds|tonumber? // 99999) <= 300' <<< "$stamp" >/dev/null; then
  verdict "restore: OK path=clone seconds=$(jq -r .restoreSeconds <<< "$stamp")"
else
  verdict "restore: RED path=$(jq -r .restorePath <<< "$stamp") seconds=$(jq -r .restoreSeconds <<< "$stamp") (criterion: clone, <= 300 s)"; red=1
fi
recover_promotion() {
  # A run interrupted after its promotion started keeps the lock: complete it (documented resume),
  # so neither the next chain nor the daily restore stays blocked; the scenario stays red.
  local run
  run=$(k get configmap radar-change-lock --ignore-not-found -o json | jq -r '(.data.record//"{}"|fromjson)|
    select(.checkpoints.promote!=null)|.run' 2>/dev/null || true)
  [[ -n $run ]] || return 0
  verdict "recovery: resume RUN=$run (promotion interrupted)"
  make -s -f deploy/cutover/operator.mk resume RUN="$run" ENV=preprod 2>&1 | tee -a "$OUT/recovery.log" || true
}
# scenario <name> <samedb|preprod> <operator target> [make arguments...]
scenario() {
  local name=$1 mode=$2 target=$3 probe pids status=0 op deadline code; shift 3
  probe="$CHAIN-$name"
  : > "$OUT/$name-reads.jsonl"; : > "$OUT/$name-writes.jsonl"
  # The read paths are served by the previous release too; the writer probe route ships with the
  # new release, so writes start once it answers anything but 404: pre-switch writes against the
  # previous release prove nothing and only pollute the verdict. The unauthenticated check never
  # writes (401 on the new release, 404 on the previous one).
  node deploy/cutover/availability-probe.mjs "$URL" "$OUT/$name-reads.jsonl" & pids=$!
  make -s -f deploy/cutover/operator.mk "$target" RELEASE="$RELEASE" MODE=run "$@" ENV=preprod 2>&1 | tee "$OUT/$name-run.log" & op=$!
  deadline=$((SECONDS+900))
  while kill -0 "$op" 2>/dev/null && ((SECONDS < deadline)); do
    code=$(curl -q -sS --max-time 5 -o /dev/null -w '%{http_code}' -X POST "$URL/api/internal/cutover-probe" \
      -H 'content-type: application/json' -d '{"run":"route-check","seq":0}' 2>/dev/null || echo 000)
    [[ $code == 404 || $code == 000 ]] || break
    sleep 2
  done
  node deploy/cutover/writer-probe.mjs "$URL" "$probe" "$OUT/$name-writes.jsonl" & pids="$pids $!"
  wait "$op" || { status=1; recover_promotion; }
  sleep 10
  # shellcheck disable=SC2086
  kill -TERM $pids; wait $pids || true
  k get configmap radar-cutover-receipt -o json | jq '.data.receipt|fromjson' > "$OUT/$name-receipt.json"
  make -s -f deploy/cutover/operator.mk probe-verify PROBE="$probe" OUTPUT="$OUT/$name" ENV=preprod || status=1
  if [[ -s $OUT/$name/probe-ranges.json ]]; then
    node deploy/cutover/probe-verify.mjs "$OUT/$name-reads.jsonl" "$OUT/$name-writes.jsonl" "$OUT/$name-receipt.json" \
      "$OUT/$name/probe-ranges.json" "$mode" > "$OUT/$name-verdict.json" || status=1
  fi
  jq -e -f tools/make/cutover-sessions.jq "$OUT/$name-receipt.json" >/dev/null || status=1
  jq -e '(.logGaps//[])|length==0' "$OUT/$name-receipt.json" >/dev/null || status=1
  prepared_slot_gone || status=1
  if ((status == 0)); then verdict "$name: OK $(jq -c .stats "$OUT/$name-verdict.json")"
  else verdict "$name: RED $(jq -c '.violations//{}|map_values(.count)' "$OUT/$name-verdict.json" 2>/dev/null)"; red=1; fi
}
# Re-run after a rehearsal that stayed red after its promotion: the release is already served, so
# the scenarios would switch from the release to itself. The rehearsal first replays the previous
# release recorded by that rehearsal (production path, SAMEDB, its recorded specs), then rehearses
# previous -> new again.
served_now=$(mktemp)
curl -q -sS --max-time 15 -o "$served_now" "$URL/health" >/dev/null 2>&1 || true
if jq -e --slurpfile r "$RELEASE" '.sha==$r[0].gitSha' "$served_now" >/dev/null 2>&1; then
  recorded=$(k get configmap radar-rehearsal-receipt --ignore-not-found -o json 2>/dev/null || true)
  if [[ -n $recorded ]] && jq -e --slurpfile r "$RELEASE" '.data.gitSha==$r[0].gitSha and
      (.data.previousRelease//""|length>0) and (.data.previousSpecs//""|length>0)' <<< "$recorded" >/dev/null 2>&1; then
    REPLAY_FROM=$(jq -c '.data|{previousRelease,previousSpecs}' <<< "$recorded")
    jq -r '.data.previousRelease' <<< "$recorded" > "$OUT/previous-release.json"
    jq -r '.data.previousSpecs' <<< "$recorded" > "$OUT/previous-specs.json"
    verdict "replay: release already served after a red rehearsal; back to $(jq -r '.gitSha[0:7]' "$OUT/previous-release.json") first"
    scenario restore-previous samedb run RELEASE="$OUT/previous-release.json" SAMEDB=1 OBSERVE=0 REPLAY_SPECS="$OUT/previous-specs.json"
  else verdict 'replay: RED the release is already served and no previous release is recorded'; red=1; fi
fi
rm -f "$served_now"
scenario preprod preprod run OBSERVE=120 DRILL=1
# The rehearsal must exercise a version change: previous release != new release.
if jq -e '.previousRelease.gitSha != .release.gitSha' "$OUT/preprod-receipt.json" >/dev/null 2>&1; then
  verdict "version change: OK $(jq -r '.previousRelease.gitSha[0:7]+" -> "+.release.gitSha[0:7]' "$OUT/preprod-receipt.json")"
else verdict 'version change: RED previous release == release (nothing switched between versions)'; red=1; fi
# Rollback after promotion (R2/R4 path in preprod): rebuild the previous release on the retained
# database (unfrozen first, writes reopened), freeze the promoted one, switch and promote; then
# re-promote the new release the same way (rollback of the rollback).
promoted_run() { jq -r 'select(.checkpoints.promote=="completed")|.run' "$OUT/$1-receipt.json" 2>/dev/null || true; }
probe_ack() {
  # The rollback scenarios abandon (at least) their own probe writes: acknowledged only when not a
  # single row outside the probe table was abandoned; the proof lands in radar-retained-db and here.
  local run
  run=$(jq -r 'select((.abandoned.tuples//0) != 0)|.run' "$OUT/$1-receipt.json" 2>/dev/null || true)
  [[ -n $run ]] || return 0
  if make -s -f deploy/cutover/operator.mk ack-probe RUN="$run" ENV=preprod 2>&1 | tee "$OUT/$1-ack.log"; then
    verdict "$1 abandoned writes: OK $(tail -1 "$OUT/$1-ack.log")"
  else verdict "$1 abandoned writes: RED not explained by the probe; conductor ack required"; red=1; fi
  k get configmap radar-retained-db -o json | jq '.data.entries|fromjson' > "$OUT/retained-db.json" || true
}
run_a=$(promoted_run preprod)
if [[ -n $run_a ]]; then
  scenario rollback preprod rollback RUN="$run_a"
  probe_ack rollback
  jq -e --arg a "$run_a" '.rollbackOf==$a and any(.jobs|keys[]; .=="unfreezeprev")' "$OUT/rollback-receipt.json" >/dev/null ||
    { verdict 'rollback: RED no rollback receipt with the unfreeze of the retained database'; red=1; }
  run_b=$(promoted_run rollback)
  if [[ -n $run_b ]]; then scenario repromote preprod rollback RUN="$run_b"; probe_ack repromote
  else verdict 'repromote: RED rollback not promoted'; red=1; fi
else verdict 'rollback: RED previous scenario not promoted'; red=1; fi
scenario samedb samedb run SAMEDB=1 OBSERVE=60
rehearsal_receipt "$( ((red == 0)) && echo green || echo red)"
exit "$red"
