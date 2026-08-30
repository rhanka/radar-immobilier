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
# Baseline-relatif (Option A, i-cond 2026-08-30) : ne bloquer que les docSha-sans-citation NOUVEAUX
# (présents en grounded, absents du baseline). Un docSha-sans-citation PRÉ-EXISTANT dans le baseline est
# une lacune de données, PAS une invention du grounding (build-grounded ne stampe JAMAIS un docSha sans
# citation) → toléré, 0 régression (déjà servi ainsi). Le check garde son rôle anti-bug : si build-grounded
# introduit un docSha-sans-citation NOUVEAU (bug), c'est bloqué.
grounded_bad=$(jq -c '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.docSha//"")|length>0) and ((.properties.citation//"")|length==0)) | .id]' "$CANDIDATE" 2>/dev/null || echo '[]')
baseline_hadsha=$(jq -c '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and (((.properties.docSha//"")|length>0) or (any((.refs//[])[]?; (.docSha//"")|length>0)))) | .id]' "$BASELINE" 2>/dev/null || echo '[]')
new_bad=$(jq -n --argjson g "$grounded_bad" --argjson b "$baseline_hadsha" '($g - $b)' 2>/dev/null || echo '[]')
new_bad_n=$(jq -n --argjson x "$new_bad" '$x|length' 2>/dev/null || echo 0)
uncited_with_sha=$(jq -n --argjson x "$grounded_bad" '$x|length' 2>/dev/null || echo 0)

if [ "${cited_targets:-0}" -eq 0 ]; then
  log "BLOCKED 7bis: aucune citation verbatim (docsha=$docsha_targets)"
  emit_blocked "no_verbatim_citation_docsha${docsha_targets}"; exit 1
fi
if [ "${new_bad_n:-0}" -gt 0 ]; then
  log "BLOCKED 7bis: $new_bad_n NOUVEAUX docSha-sans-citation introduits par grounding: $new_bad"
  emit_blocked "new_uncited_targets_with_docsha_${new_bad_n}"; exit 1
fi
if [ "${uncited_with_sha:-0}" -gt 0 ]; then
  log "7bis: $uncited_with_sha docSha-sans-citation PRÉ-EXISTANTS baseline tolérés (Option A, 0 régression)"
fi

# ── Anti-régression (garde i-arch (b)) : un nœud CITÉ dans le baseline (props.citation OU refs[].excerpt,
#    def officielle withCitation) NE DOIT JAMAIS devenir non-cité dans le grounded. Bloque tout clobber
#    d'une citation servie. (Complète la K2 de k8s au niveau gate-host.) ──
base_cited_ids=$(jq -c '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and (((.properties.citation//"")|length>0) or (any((.refs//[])[]?; (.excerpt//"")|length>0)))) | .id]' "$BASELINE" 2>/dev/null || echo '[]')
grounded_cited_ids=$(jq -c '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and (((.properties.citation//"")|length>0) or (any((.refs//[])[]?; (.excerpt//"")|length>0)))) | .id]' "$CANDIDATE" 2>/dev/null || echo '[]')
regressed=$(jq -n --argjson b "$base_cited_ids" --argjson g "$grounded_cited_ids" '($b - $g)' 2>/dev/null || echo '[]')
regressed_n=$(jq -n --argjson x "$regressed" '$x|length' 2>/dev/null || echo 0)
if [ "${regressed_n:-0}" -gt 0 ]; then
  log "BLOCKED 7bis: RÉGRESSION — $regressed_n nœud(s) cité(s)-baseline devenu(s) non-cité(s): $regressed"
  emit_blocked "regression_baseline_cited_uncited_${regressed_n}"; exit 1
fi

log "7bis OK ($cited_targets citations verbatim)"

# ── Mode CHECK_ONLY (text-split, modèle b) : le 7bis tourne sur le HOST, mais le PUBLISH est fait par
#    le pod in-cluster (k8s STAGE 3). On valide 7bis (fail-closed déjà fait ci-dessus) et on SORT 0
#    SANS publier. k8s ne publie QUE le grounded.v23.json 7bis-passant que le host lui rend. ──
if [ -n "${CHECK_ONLY:-}" ]; then
  log "CHECK_ONLY : 7bis validé, publish délégué au pod in-cluster (k8s STAGE 3)"
  exit 0
fi

# ── 2-bucket (préprod-safe) : le PUBLISH doit viser le PUBLISH bucket (OVH préprod-graph), JAMAIS le
#    READ bucket (SCW -pocs / prod). Le gate canonique publie vers SCRAPE_S3_BUCKET/ENDPOINT avec AWS_*.
#    On surcharge ces variables ICI (wrapper grounding) avec les valeurs PUBLISH → gate.sh partagé
#    INCHANGÉ. Fallback SCRAPE_S3_*/AWS_* = mode single-bucket (dev/legacy) : comportement identique. ──
export SCRAPE_S3_BUCKET="${PUBLISH_S3_BUCKET:-${SCRAPE_S3_BUCKET:-}}"
export SCRAPE_S3_ENDPOINT="${PUBLISH_S3_ENDPOINT:-${SCRAPE_S3_ENDPOINT:-}}"
export AWS_ACCESS_KEY_ID="${PUBLISH_AWS_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
export AWS_SECRET_ACCESS_KEY="${PUBLISH_AWS_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"

# ── Délégation au gate canonique (shape/préservation/refs + publish → PUBLISH_BUCKET préprod) ──
exec bash "$CANON_GATE" "$CITY" "$CANDIDATE" "$BASELINE" "$RUN_DIR" "$LANE_ID"
