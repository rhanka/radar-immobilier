#!/usr/bin/env bash
# gate-grounding.sh — wrapper de publication SPÉCIFIQUE au grounding verbatim.
#
# Usage: gate-grounding.sh <city> <candidate_json> <baseline_json> <run_dir> <lane_id>
# (signature identique à tools/graphify-v23/gate.sh)
#
# Rôle : ajouter un check « gate 7bis » PROPRE AU GROUNDING — tout nœud-cible
#        (Signal/DesignationEvent) qui porte un docSha DOIT porter une citation
#        verbatim non vide, sinon le LLM a échoué et on publierait un ancrage
#        sans preuve textuelle. On exige aussi qu'au moins une citation existe.
#
# ⚠️ Ce check N'EST PAS dans le gate canonique tools/graphify-v23/gate.sh :
#    le gate partagé sert aussi au flux re-graphify où des signaux 2.1/2.2
#    légitimes n'ont pas encore de citation — l'y mettre casserait ce flux.
#    Le check vit donc ici, en local grounding uniquement.
#
# Flux : 7bis d'abord (refus rapide sans publish) → délègue au gate canonique
#        (shape/header/préservation/refs grounded + publish atomique SCW).
# Exit 0 si published, 1 sinon. Écrit une ligne JSONL blocked dans
# $run_dir/status/central.jsonl en cas d'échec 7bis (même format que le gate).
set -euo pipefail

CITY="${1:?city requis}"
CANDIDATE="${2:?candidate_json requis}"
BASELINE="${3:?baseline_json requis}"
RUN_DIR="${4:?run_dir requis}"
LANE_ID="${5:-central}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CANON_GATE="$ROOT/tools/graphify-v23/gate.sh"

STATUS_FILE="$RUN_DIR/status/central.jsonl"
mkdir -p "$RUN_DIR/status"

log() { echo "[gate-grounding/$CITY] $*"; }

# Émet une ligne de statut "blocked" au même format que le gate canonique,
# pour que les drivers/agrégateurs (jq sur central.jsonl) restent cohérents.
emit_blocked() {
  local reason="$1"
  local started_at finished_at
  started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  finished_at="$started_at"
  local newSignals newEvents nodes_count edges_count
  newSignals=$(jq '[.nodes[]? | select(.type=="Signal")] | length' "$CANDIDATE" 2>/dev/null || echo 0)
  newEvents=$(jq '[.nodes[]? | select(.type=="DesignationEvent")] | length' "$CANDIDATE" 2>/dev/null || echo 0)
  nodes_count=$(jq '.nodes|length' "$CANDIDATE" 2>/dev/null || echo 0)
  edges_count=$(jq '.edges|length' "$CANDIDATE" 2>/dev/null || echo 0)
  jq -cn \
    --arg city "$CITY" \
    --arg status "blocked" \
    --argjson oldSignals 0 \
    --argjson oldEvents 0 \
    --argjson newSignals "$newSignals" \
    --argjson newEvents "$newEvents" \
    --argjson nodes "$nodes_count" \
    --argjson edges "$edges_count" \
    --arg reason "$reason" \
    --arg lane "$LANE_ID" \
    --arg startedAt "$started_at" \
    --arg finishedAt "$finished_at" \
    --argjson validatedExtraction true \
    --argjson published false \
    '{city:$city,status:$status,lane:$lane,oldSignals:$oldSignals,oldEvents:$oldEvents,newSignals:$newSignals,newEvents:$newEvents,nodes:$nodes,edges:$edges,validatedExtraction:$validatedExtraction,published:$published,reason:$reason,startedAt:$startedAt,finishedAt:$finishedAt}' \
    >> "$STATUS_FILE"
  printf '\n' >> "$STATUS_FILE"
}

# ── Sanity ────────────────────────────────────────────────────────────────────
if [ ! -f "$CANDIDATE" ]; then
  emit_blocked "candidate_missing"; exit 1
fi
if [ ! -f "$CANON_GATE" ]; then
  log "ERREUR: gate canonique introuvable: $CANON_GATE"
  emit_blocked "canon_gate_missing"; exit 1
fi

# ── Gate 7bis — citation verbatim obligatoire (grounding-local) ───────────────
# Tout noeud-cible portant un docSha DOIT avoir une citation verbatim non vide.
cited_targets=$(jq '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.citation//"")|length>0))] | length' "$CANDIDATE" 2>/dev/null || echo 0)
docsha_targets=$(jq '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.docSha//"")|length>0))] | length' "$CANDIDATE" 2>/dev/null || echo 0)
uncited_with_sha=$(jq '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.docSha//"")|length>0) and ((.properties.citation//"")|length==0))] | length' "$CANDIDATE" 2>/dev/null || echo 0)

if [ "${cited_targets:-0}" -eq 0 ]; then
  log "BLOCKED 7bis: aucune citation verbatim (docsha=$docsha_targets)"
  emit_blocked "no_verbatim_citation_docsha${docsha_targets}"; exit 1
fi
if [ "${uncited_with_sha:-0}" -gt 0 ]; then
  log "BLOCKED 7bis: $uncited_with_sha/$docsha_targets cibles avec docSha sans citation"
  emit_blocked "uncited_targets_with_docsha_${uncited_with_sha}of${docsha_targets}"; exit 1
fi

log "7bis OK ($cited_targets citations verbatim) → délègue au gate canonique"

# ── Délégation au gate canonique (shape/préservation/refs + publish SCW) ──────
exec bash "$CANON_GATE" "$CITY" "$CANDIDATE" "$BASELINE" "$RUN_DIR" "$LANE_ID"
