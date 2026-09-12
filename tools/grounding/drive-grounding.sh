#!/usr/bin/env bash
# drive-grounding.sh — pilote séquentiel/faible-concurrence du grounding verbatim.
# Lit une worklist (1 ville/ligne), ground + gate + publish ville par ville.
# N_LANES bas (défaut 2) pour protéger la box. Résumable : skip villes déjà citées sur SCW.
#
# Usage: drive-grounding.sh <worklist> <run_dir> [n_lanes]
#
# Le gate utilisé est le wrapper grounding (gate-grounding.sh) : il applique le
# check 7bis (citation verbatim obligatoire) AVANT de déléguer au gate canonique
# tools/graphify-v23/gate.sh pour la publication atomique SCW.
set -uo pipefail

WORKLIST="${1:?worklist requis}"
RUN_DIR="${2:?run_dir requis}"
N_LANES="${3:-2}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKER="$SCRIPT_DIR/worker-grounding.sh"
GATE="$SCRIPT_DIR/gate-grounding.sh"

# ── 2-bucket split (préprod-safe, IN-CLUSTER) ─────────────────────────────────
# Modèle d'exécution = IN-CLUSTER : PAS de `.env` host (extraction de secrets host refusée). Les
# variables viennent de 2 secretRef montés en env dans le pod :
#   READ_*    ← secretRef `radar-s3-credentials`      (SCW -pocs, RO : raw PVs + .meta.json sidecars)
#   PUBLISH_* ← secretRef `radar-graph-s3-credentials` (OVH préprod : graph/<city>/latest.json)
# READ est STRICTEMENT RO (worker seulement) ; 0 write vers READ_BUCKET ni vers le prod-graph.
# Le `.env` host n'est sourcé QUE s'il existe (dev/local) — jamais requis in-cluster.
[ -f "$REPO/.env" ] && { set -a; source "$REPO/.env"; set +a; }
# Résolution (fallback SCRAPE_S3_* = mode single-bucket dev/local uniquement).
READ_S3_ENDPOINT="${READ_S3_ENDPOINT:-${SCRAPE_S3_ENDPOINT:-}}"
READ_S3_BUCKET="${READ_S3_BUCKET:-${SCRAPE_S3_BUCKET:-}}"
READ_AWS_ACCESS_KEY_ID="${READ_AWS_ACCESS_KEY_ID:-${SCRAPE_S3_ACCESS_KEY:-}}"
READ_AWS_SECRET_ACCESS_KEY="${READ_AWS_SECRET_ACCESS_KEY:-${SCRAPE_S3_SECRET_KEY:-}}"
PUBLISH_S3_ENDPOINT="${PUBLISH_S3_ENDPOINT:-${SCRAPE_S3_ENDPOINT:-}}"
PUBLISH_S3_BUCKET="${PUBLISH_S3_BUCKET:-${SCRAPE_S3_BUCKET:-}}"
PUBLISH_AWS_ACCESS_KEY_ID="${PUBLISH_AWS_ACCESS_KEY_ID:-${SCRAPE_S3_ACCESS_KEY:-}}"
PUBLISH_AWS_SECRET_ACCESS_KEY="${PUBLISH_AWS_SECRET_ACCESS_KEY:-${SCRAPE_S3_SECRET_KEY:-}}"
# ── FAIL-CLOSED sur LES DEUX buckets : rien ne tourne à moitié configuré (sinon publish silencieux
#    au mauvais endroit). Refuse si UNE des 8 variables est vide. ──
for v in READ_S3_ENDPOINT READ_S3_BUCKET READ_AWS_ACCESS_KEY_ID READ_AWS_SECRET_ACCESS_KEY \
         PUBLISH_S3_ENDPOINT PUBLISH_S3_BUCKET PUBLISH_AWS_ACCESS_KEY_ID PUBLISH_AWS_SECRET_ACCESS_KEY; do
  if [ -z "${!v:-}" ]; then
    echo "[drive] FAIL-CLOSED: variable $v vide — READ_* + PUBLISH_* requis (2 secretRef in-cluster)." >&2
    exit 2
  fi
done
export READ_S3_ENDPOINT READ_S3_BUCKET READ_AWS_ACCESS_KEY_ID READ_AWS_SECRET_ACCESS_KEY
export PUBLISH_S3_ENDPOINT PUBLISH_S3_BUCKET PUBLISH_AWS_ACCESS_KEY_ID PUBLISH_AWS_SECRET_ACCESS_KEY
export AWS_REGION="${SCRAPE_S3_REGION:-us-east-1}"
# Le drive lit le BASELINE graph (fetch/backup/already_cited) depuis PUBLISH (préprod) → creds PUBLISH.
export AWS_ACCESS_KEY_ID="$PUBLISH_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$PUBLISH_AWS_SECRET_ACCESS_KEY"
S3_URL="$PUBLISH_S3_ENDPOINT"; BUCKET="$PUBLISH_S3_BUCKET"
# ── Frontière de sûreté = le PRÉFIXE, pas le nom du bucket. La garde dure vit au point d'ÉCRITURE
#    (publish-citation-grounding + gate canonique n'écrivent QUE graph/ + parsed/, jamais la zone READ
#    raw/proces-verbaux + .meta). READ==PUBLISH (single-bucket) est donc un mode LÉGITIME : le graph store
#    et les docs source peuvent partager un bucket. Le fail-closed DUR reste sur les creds vides (boucle
#    des 8 variables ci-dessus). ──
if [ "$READ_S3_BUCKET" = "$PUBLISH_S3_BUCKET" ]; then
  echo "[drive] single-bucket (READ==PUBLISH=$PUBLISH_S3_BUCKET) — mode normal ; prefix-safety au point d'écriture (graph/ only)." >&2
fi

mkdir -p "$RUN_DIR/status" "$RUN_DIR/logs" "$RUN_DIR/workers" "$RUN_DIR/lanes"
STATUS_FILE="$RUN_DIR/status/central.jsonl"
touch "$STATUS_FILE"

# ── Plafond DUR d'appels LLM, PARTAGÉ entre toutes les villes/lanes du run (cost-gate cohorte, i-cond).
#    MAX_LLM_CALLS vide/unset = illimité (pilote 1 ville / runs host manuels). Le worker réserve chaque
#    appel codex de façon atomique (flock) contre ce compteur → 0 appel au-delà du cap (arrêt dur net). ──
export MAX_LLM_CALLS="${MAX_LLM_CALLS:-}"
export LLM_CALL_COUNTER_FILE="$RUN_DIR/llm-call-count"
printf '0' > "$LLM_CALL_COUNTER_FILE"
# ── Discipline 429 codex (worker-grounding, prérequis wave) : purge d'un run précédent le flag STOP-DUR
#    global + le lock de sérialisation concurrence-1 (le run_dir est neuf/horodaté ⇒ ceinture+bretelles).
#    Le worker crée/écrit ${counter}.codex-429-stop au 1er 429 ; process_city + le worker s'y arrêtent. ──
rm -f "${LLM_CALL_COUNTER_FILE}.codex-429-stop" "${LLM_CALL_COUNTER_FILE}.codex-serial.lock"

log(){ echo "[drive $(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/run.log"; }

# already cited in PUBLISH (préprod graph) ? — DOIT lire PUBLISH_BUCKET, PAS prod : sinon on skippe
# des villes selon l'état PROD → villes non-groundées-en-préprod sautées silencieusement (i-arch).
already_cited(){
  local city="$1"
  local n
  n=$(s5cmd --endpoint-url "$S3_URL" cat "s3://$BUCKET/graph/${city}/latest.json" 2>/dev/null | \
    jq '[.nodes[]?|select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.citation//"")|length>0))]|length' 2>/dev/null || echo 0)
  [ "${n:-0}" -gt 0 ] 2>/dev/null
}

process_city(){
  local city="$1" lane="$2"
  local W="$RUN_DIR/workers/$city"; mkdir -p "$W"
  # (b) STOP DUR 429 global : si un 429 a déjà stoppé le run, ne DÉMARRE aucune nouvelle ville (0 nouvel appel codex).
  if [ -e "${LLM_CALL_COUNTER_FILE}.codex-429-stop" ]; then
    log "[$lane/$city] SKIP — arrêt dur 429 global actif (anti-martèlement pool codex)"; return 0
  fi
  if already_cited "$city"; then
    log "[$lane/$city] SKIP déjà cité sur SCW"; return 0
  fi
  if ! s5cmd --endpoint-url "$S3_URL" cat "s3://$BUCKET/graph/$city/latest.json" > "$W/candidate.v23.json" 2>/dev/null || [ ! -s "$W/candidate.v23.json" ]; then
    log "[$lane/$city] BLOCKED candidate_missing"; return 1
  fi
  cp "$W/candidate.v23.json" "$W/baseline.json"
  bash "$WORKER" "$city" "$W/candidate.v23.json" "$W/grounded.v23.json" "$W/grounding-work" "$REPO" > "$W/grounding.log" 2>&1
  if [ ! -s "$W/grounded.v23.json" ]; then
    log "[$lane/$city] BLOCKED grounded_empty ($(tail -1 "$W/grounding.log" 2>/dev/null))"; return 1
  fi
  if bash "$GATE" "$city" "$W/grounded.v23.json" "$W/baseline.json" "$RUN_DIR" "$lane" >> "$W/gate.log" 2>&1; then
    local cit; cit=$(jq '[.nodes[]?|select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.citation//"")|length>0))]|length' "$W/grounded.v23.json" 2>/dev/null)
    log "[$lane/$city] PUBLISHED ($cit citations verbatim)"; return 0
  else
    local r; r=$(tail -1 "$RUN_DIR/status/central.jsonl" 2>/dev/null | jq -r '.reason' 2>/dev/null)
    log "[$lane/$city] GATE-BLOCKED reason=$r"; return 1
  fi
}
export -f process_city already_cited log
export RUN_DIR STATUS_FILE S3_URL BUCKET REPO WORKER GATE

# Dispatch round-robin
mapfile -t CITIES < <(grep -v '^[[:space:]]*$' "$WORKLIST")
for i in $(seq 1 "$N_LANES"); do : > "$RUN_DIR/lanes/lane-$i.txt"; done
idx=0
for c in "${CITIES[@]}"; do
  l=$(( (idx % N_LANES) + 1 ))
  echo "$c" >> "$RUN_DIR/lanes/lane-$l.txt"
  idx=$((idx+1))
done
log "Worklist: ${#CITIES[@]} villes, $N_LANES lanes"

PIDS=()
for i in $(seq 1 "$N_LANES"); do
  lf="$RUN_DIR/lanes/lane-$i.txt"; [ -s "$lf" ] || continue
  (
    while IFS= read -r city; do
      [ -z "$city" ] && continue
      process_city "$city" "lane-$i" || true
    done < "$lf"
    log "[lane-$i] DONE"
  ) &
  PIDS+=($!)
done
for p in "${PIDS[@]}"; do wait "$p" 2>/dev/null || true; done

log "=== TERMINÉ ==="
log "Publiées ce run: $(jq -r 'select(.published==true)|.city' "$STATUS_FILE" 2>/dev/null | sort -u | wc -l)"
jq -r 'select(.published==true)|.city' "$STATUS_FILE" 2>/dev/null | sort -u | tee "$RUN_DIR/published.txt" >> "$RUN_DIR/run.log"
log "--- raisons blocage ---"
jq -r 'select(.status=="blocked")|.reason' "$STATUS_FILE" 2>/dev/null | sed -E 's/[0-9]+/N/g' | sort | uniq -c | sort -rn | tee -a "$RUN_DIR/run.log"
