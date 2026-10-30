#!/usr/bin/env bash
# Preprod CI/CD rehearsal of the zero-downtime cutover (R3). Two scenarios on the release
# just prepared, each under the read and writer probes, each judged by probe-verify.mjs:
#   1. SAMEDB=1 OBSERVE=60: the production path (one database, images only, no freeze);
#   2. OBSERVE=120 DRILL=1: the preprod path (freeze, prepared database, routing drill).
# Plus the restore criterion of the prepared stamp (restorePath=clone, restoreSeconds<=300)
# and the post-run state (no prepared slot left, sessions <= 80 % of max_connections).
set -euo pipefail
[[ ${ENV:-} == preprod ]] || { echo 'Rehearsal is preprod-only' >&2; exit 2; }
[[ -n ${RELEASE:-} ]] || { echo 'RELEASE=<release.json> is required' >&2; exit 2; }
[[ ${#CUTOVER_PROBE_TOKEN} -ge 32 ]] || { echo 'CUTOVER_PROBE_TOKEN (32+ characters) is required' >&2; exit 2; }
CONFIG=deploy/cutover/config.json
NS=$(jq -r .preprod.namespace "$CONFIG"); URL=$(jq -r .preprod.url "$CONFIG")
OUT=${OUTPUT:-.bascule-work/rehearsal}
mkdir -p "$OUT"
red=0
k() { kubectl --request-timeout=15s -n "$NS" "$@"; }
verdict() { printf '%s\n' "$*" | tee -a "$OUT/verdict.txt"; }
stamp=$(k get configmap radar-prepared-db -o json | jq -c .data)
printf '%s\n' "$stamp" | jq '{status,restorePath,restoreSeconds,targetDb,gitSha}' > "$OUT/prepared-stamp.json"
if jq -e '.restorePath=="clone" and (.restoreSeconds|tonumber? // 99999) <= 300' <<< "$stamp" >/dev/null; then
  verdict "restore: OK path=clone seconds=$(jq -r .restoreSeconds <<< "$stamp")"
else
  verdict "restore: RED path=$(jq -r .restorePath <<< "$stamp") seconds=$(jq -r .restoreSeconds <<< "$stamp") (criterion: clone, <= 300 s)"; red=1
fi
scenario() {
  local name=$1 mode=$2 probe pids status=0; shift 2
  probe="rh-$(date -u +%s)-$name"
  : > "$OUT/$name-reads.jsonl"; : > "$OUT/$name-writes.jsonl"
  node deploy/cutover/availability-probe.mjs "$URL" "$OUT/$name-reads.jsonl" & pids=$!
  node deploy/cutover/writer-probe.mjs "$URL" "$probe" "$OUT/$name-writes.jsonl" & pids="$pids $!"
  sleep 10
  make -s -f deploy/cutover/operator.mk run RELEASE="$RELEASE" MODE=run "$@" ENV=preprod 2>&1 | tee "$OUT/$name-run.log" || status=1
  sleep 10
  # shellcheck disable=SC2086
  kill -TERM $pids; wait $pids || true
  k get configmap radar-cutover-receipt -o json | jq '.data.receipt|fromjson' > "$OUT/$name-receipt.json"
  make -s -f deploy/cutover/operator.mk probe-verify PROBE="$probe" OUTPUT="$OUT/$name" ENV=preprod || status=1
  if [[ -s $OUT/$name/probe-ranges.json ]]; then
    node deploy/cutover/probe-verify.mjs "$OUT/$name-reads.jsonl" "$OUT/$name-writes.jsonl" "$OUT/$name-receipt.json" \
      "$OUT/$name/probe-ranges.json" "$mode" > "$OUT/$name-verdict.json" || status=1
  fi
  jq -e '[.jobs.database.verdict.sessionsByDb//{}|to_entries[].value]|add as $n|
    ($n//0) <= 0.8*(.jobs.database.verdict.maxConnections//0)' "$OUT/$name-receipt.json" >/dev/null || status=1
  if k get deployment radar-api-prepared --ignore-not-found -o name | grep -q .; then status=1; fi
  if ((status == 0)); then verdict "$name: OK $(jq -c .stats "$OUT/$name-verdict.json")"
  else verdict "$name: RED $(jq -c '.violations//{}|map_values(.count)' "$OUT/$name-verdict.json" 2>/dev/null)"; red=1; fi
}
scenario samedb samedb SAMEDB=1 OBSERVE=60
scenario preprod preprod OBSERVE=120 DRILL=1
exit "$red"
