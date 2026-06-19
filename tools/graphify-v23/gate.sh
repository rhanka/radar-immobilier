#!/usr/bin/env bash
# gate.sh — gate central v2.3 : validation + publish atomique
# Usage: gate.sh <city> <candidate_json> <baseline_json> <run_dir> <lane_id>
# Écrit une ligne JSONL dans $run_dir/status/central.jsonl
# Exit 0 si published, 1 sinon
set -euo pipefail

CITY="${1:?city requis}"
CANDIDATE="${2:?candidate_json requis}"
BASELINE="${3:?baseline_json requis}"
RUN_DIR="${4:?run_dir requis}"
LANE_ID="${5:-central}"

STATUS_FILE="$RUN_DIR/status/central.jsonl"
mkdir -p "$RUN_DIR/status"

S3_URL="${SCRAPE_S3_ENDPOINT:-}"
BUCKET="${SCRAPE_S3_BUCKET:-}"

started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
status="blocked"
reason=""
published=false
validatedExtraction=false
oldSignals=0
oldEvents=0
newSignals=0
newEvents=0
nodes_count=0
edges_count=0

emit_status() {
  local finished_at
  finished_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  jq -cn \
    --arg city "$CITY" \
    --arg status "$status" \
    --argjson oldSignals "$oldSignals" \
    --argjson oldEvents "$oldEvents" \
    --argjson newSignals "$newSignals" \
    --argjson newEvents "$newEvents" \
    --argjson nodes "$nodes_count" \
    --argjson edges "$edges_count" \
    --arg reason "$reason" \
    --arg lane "$LANE_ID" \
    --arg startedAt "$started_at" \
    --arg finishedAt "$finished_at" \
    --argjson validatedExtraction "$validatedExtraction" \
    --argjson published "$published" \
    '{city:$city,status:$status,lane:$lane,oldSignals:$oldSignals,oldEvents:$oldEvents,newSignals:$newSignals,newEvents:$newEvents,nodes:$nodes,edges:$edges,validatedExtraction:$validatedExtraction,published:$published,reason:$reason,startedAt:$startedAt,finishedAt:$finishedAt}' \
    >> "$STATUS_FILE"
  printf '\n' >> "$STATUS_FILE"
}

# ── 0. Sanity checks ──────────────────────────────────────────────────────────
if [ ! -f "$CANDIDATE" ]; then
  reason="candidate_missing"
  emit_status
  exit 1
fi

if [ ! -f "$BASELINE" ]; then
  reason="baseline_missing"
  emit_status
  exit 1
fi

# ── 1. Comptages baseline ─────────────────────────────────────────────────────
oldSignals=$(jq '[.nodes[]? | select(.type=="Signal")] | length' "$BASELINE" 2>/dev/null || echo 0)
oldEvents=$(jq '[.nodes[]? | select(.type=="DesignationEvent")] | length' "$BASELINE" 2>/dev/null || echo 0)

# ── 2. Shape header ───────────────────────────────────────────────────────────
if ! jq -e --arg city "$CITY" \
  '.ontology_version == "2.3" and .municipality == $city and (.nodes|type=="array") and (.edges|type=="array")' \
  "$CANDIDATE" >/dev/null 2>&1; then
  reason="graph_shape_or_header_invalid"
  newSignals=$(jq '[.nodes[]? | select(.type=="Signal")] | length' "$CANDIDATE" 2>/dev/null || echo 0)
  newEvents=$(jq '[.nodes[]? | select(.type=="DesignationEvent")] | length' "$CANDIDATE" 2>/dev/null || echo 0)
  emit_status
  exit 1
fi

# ── 3. Node/edge shape ────────────────────────────────────────────────────────
node_shape_ok=$(jq -r 'if (.nodes|type=="array") then
  (.nodes | all(.[]; (.id|type=="string") and (.type|type=="string") and (.label|type=="string") and ((.properties//{})|type=="object")))
  | if . then 1 else 0 end
  else 0 end' "$CANDIDATE" 2>/dev/null || echo 0)

edge_shape_ok=$(jq -r 'if (.edges|type=="array") then
  (.edges | all(.[]; (.source|type=="string") and (.target|type=="string") and (.type|type=="string") and ((.refs//[])|type=="array")))
  | if . then 1 else 0 end
  else 0 end' "$CANDIDATE" 2>/dev/null || echo 0)

if [ "$node_shape_ok" != "1" ] || [ "$edge_shape_ok" != "1" ]; then
  reason="node_or_edge_shape_invalid"
  newSignals=$(jq '[.nodes[]? | select(.type=="Signal")] | length' "$CANDIDATE" 2>/dev/null || echo 0)
  newEvents=$(jq '[.nodes[]? | select(.type=="DesignationEvent")] | length' "$CANDIDATE" 2>/dev/null || echo 0)
  emit_status
  exit 1
fi

# ── 4. Comptages candidat ─────────────────────────────────────────────────────
newSignals=$(jq '[.nodes[]? | select(.type=="Signal")] | length' "$CANDIDATE" 2>/dev/null || echo 0)
newEvents=$(jq '[.nodes[]? | select(.type=="DesignationEvent")] | length' "$CANDIDATE" 2>/dev/null || echo 0)
nodes_count=$(jq '.nodes|length' "$CANDIDATE" 2>/dev/null || echo 0)
edges_count=$(jq '.edges|length' "$CANDIDATE" 2>/dev/null || echo 0)

# ── 5. Préservation signaux 2.1/2.2 ──────────────────────────────────────────
if [ "$newSignals" -lt "$oldSignals" ] || [ "$newEvents" -lt "$oldEvents" ]; then
  reason="signal_or_event_regression_${oldSignals}+${oldEvents}->${newSignals}+${newEvents}"
  emit_status
  exit 1
fi

# ── 6. Descriptions non vides sur Signal/DesignationEvent ────────────────────
missing_desc=$(jq '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.description//"") | length == 0))] | length' "$CANDIDATE" 2>/dev/null || echo 0)
if [ "$missing_desc" -gt 0 ]; then
  reason="missing_signal_description_count_${missing_desc}"
  validatedExtraction=true
  emit_status
  exit 1
fi

# ── 7. Refs grounded (pas de generated://) ────────────────────────────────────
generated_edge_refs=$(jq '[.edges[].refs[]? | select((.rawRef//"") | tostring | startswith("generated://"))] | length' "$CANDIDATE" 2>/dev/null || echo 0)
missing_signal_links=$(jq '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and (.properties.evidence_quality=="missing_source_link"))] | length' "$CANDIDATE" 2>/dev/null || echo 0)

if [ "$generated_edge_refs" -gt 0 ] || [ "$missing_signal_links" -gt 0 ]; then
  reason="missing_grounded_signal_ref_gen${generated_edge_refs}_miss${missing_signal_links}"
  validatedExtraction=true
  emit_status
  exit 1
fi

validatedExtraction=true

# ── 8. Publish atomique SCW ───────────────────────────────────────────────────
if [ -z "$S3_URL" ] || [ -z "$BUCKET" ]; then
  reason="scw_config_missing"
  emit_status
  exit 1
fi

if [ "${DRY_RUN:-false}" = "true" ]; then
  echo "[gate] DRY-RUN: $CITY validated — publish skipped"
  status="done"
  published=false
  reason="dry_run"
  emit_status
  exit 0
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
parsed_key="s3://$BUCKET/parsed/$CITY/graphify-v2.3/$LANE_ID/latest.candidate.json"
graph_key="s3://$BUCKET/graph/$CITY/latest.json"
backup_key="s3://$BUCKET/graph/$CITY/history/pre-v23-${LANE_ID}-${timestamp}.json"

# 8a. Upload candidat dans parsed/ (preuve que le chemin existe)
if ! s5cmd --endpoint-url "$S3_URL" cp "$CANDIDATE" "$parsed_key" >>"$RUN_DIR/logs/gate-${CITY}.log" 2>&1; then
  reason="publish_failed:parsed_key"
  emit_status
  exit 1
fi

# 8b. Backup de l'existant si présent
if s5cmd --endpoint-url "$S3_URL" ls "$graph_key" >>"$RUN_DIR/logs/gate-${CITY}.log" 2>&1; then
  if ! s5cmd --endpoint-url "$S3_URL" cp "$graph_key" "$backup_key" >>"$RUN_DIR/logs/gate-${CITY}.log" 2>&1; then
    reason="publish_failed:backup"
    emit_status
    exit 1
  fi
fi

# 8c. Publish final atomique
if ! s5cmd --endpoint-url "$S3_URL" cp "$CANDIDATE" "$graph_key" >>"$RUN_DIR/logs/gate-${CITY}.log" 2>&1; then
  reason="publish_failed:graph_key"
  emit_status
  exit 1
fi

status="done"
published=true
reason=""
emit_status
echo "[gate] $CITY PUBLISHED → $graph_key"
exit 0
