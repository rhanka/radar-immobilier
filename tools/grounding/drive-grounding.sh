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

set -a; source "$REPO/.env"; set +a
export AWS_ACCESS_KEY_ID="${SCRAPE_S3_ACCESS_KEY}"
export AWS_SECRET_ACCESS_KEY="${SCRAPE_S3_SECRET_KEY}"
export AWS_REGION="${SCRAPE_S3_REGION}"
export SCRAPE_S3_ENDPOINT SCRAPE_S3_BUCKET
S3_URL="$SCRAPE_S3_ENDPOINT"; BUCKET="$SCRAPE_S3_BUCKET"

mkdir -p "$RUN_DIR/status" "$RUN_DIR/logs" "$RUN_DIR/workers" "$RUN_DIR/lanes"
STATUS_FILE="$RUN_DIR/status/central.jsonl"
touch "$STATUS_FILE"

log(){ echo "[drive $(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/run.log"; }

# already cited on SCW ?
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
