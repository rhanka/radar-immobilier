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
if [[ ${1:-} == check ]]; then
  # Version-change guard for the CI: "same" when the served build already is the release (a re-run
  # of the same main workflow) -> the rehearsal is skipped (neutral); "changed" otherwise.
  served=$(mktemp)
  code=$(curl -q -sS --max-time 15 -o "$served" -w '%{http_code}' "$URL/health" 2>/dev/null || echo 000)
  if [[ ${code%% *} == 200 ]] && jq -e --slurpfile r "$RELEASE" '.sha==$r[0].gitSha' "$served" >/dev/null 2>&1; then echo same; else echo changed; fi
  rm -f "$served"
  exit 0
fi
[[ ${#CUTOVER_PROBE_TOKEN} -ge 32 ]] || { echo 'CUTOVER_PROBE_TOKEN (32+ characters) is required' >&2; exit 2; }
NS=$(jq -r .preprod.namespace "$CONFIG")
OUT=${OUTPUT:-.bascule-work/rehearsal}
mkdir -p "$OUT"
red=0
k() { kubectl --request-timeout=15s -n "$NS" "$@"; }
verdict() { printf '%s\n' "$*" | tee -a "$OUT/verdict.txt"; }
# Every probe run of this rehearsal shares one prefix: its abandoned writes can be proven.
CHAIN="rh-$(date -u +%s)"
# A pending retained-database entry is never overwritten: one that the conductor has not
# acknowledged (operator rollback) stops the rehearsal cleanly before any change.
pending=$(k get configmap radar-retained-db --ignore-not-found -o json | jq -c '[.data.entries//"[]"|fromjson|.[]|select(.status=="pending")]' 2>/dev/null || echo '[]')
if [[ $(jq length <<< "${pending:-[]}") != 0 ]]; then
  verdict "retained database: RED pending entries need the conductor ack first: $pending"; exit 1
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
  local name=$1 mode=$2 target=$3 probe pids status=0; shift 3
  probe="$CHAIN-$name"
  : > "$OUT/$name-reads.jsonl"; : > "$OUT/$name-writes.jsonl"
  node deploy/cutover/availability-probe.mjs "$URL" "$OUT/$name-reads.jsonl" & pids=$!
  node deploy/cutover/writer-probe.mjs "$URL" "$probe" "$OUT/$name-writes.jsonl" & pids="$pids $!"
  sleep 10
  make -s -f deploy/cutover/operator.mk "$target" RELEASE="$RELEASE" MODE=run "$@" ENV=preprod 2>&1 | tee "$OUT/$name-run.log" ||
    { status=1; recover_promotion; }
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
  if k get deployment radar-api-prepared --ignore-not-found -o name | grep -q .; then status=1; fi
  if ((status == 0)); then verdict "$name: OK $(jq -c .stats "$OUT/$name-verdict.json")"
  else verdict "$name: RED $(jq -c '.violations//{}|map_values(.count)' "$OUT/$name-verdict.json" 2>/dev/null)"; red=1; fi
}
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
  # The rollback scenarios abandon (at least) their own probe writes: acknowledged only when the
  # probe rows explain every abandoned tuple; the proof lands in radar-retained-db and here.
  local run
  run=$(jq -r 'select((.abandoned.tuples//0) != 0)|.run' "$OUT/$1-receipt.json" 2>/dev/null || true)
  [[ -n $run ]] || return 0
  if make -s -f deploy/cutover/operator.mk ack-probe RUN="$run" PROBE="$CHAIN" ENV=preprod 2>&1 | tee "$OUT/$1-ack.log"; then
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
exit "$red"
