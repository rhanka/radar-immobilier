#!/usr/bin/env bash
# runner-llm-desc-validation.sh — lot de VALIDATION étape (b) v2.3
# Enrichit les descriptions manquantes via Sonnet 4.6 pour les 12 villes cibles,
# passe le gate central, publie sur SCW.
#
# Usage: runner-llm-desc-validation.sh [--dry-run] [--run-dir <path>] [--root <path>]
#
# Cibles hardcodées : les 12 villes missing_signal_description identifiées en étape (a)
# Source des candidats : tmp/graphify-v23-v23a-publish-20260619T005818Z/workers/<city>/latest.v23.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PWD}"

DRY_RUN="false"
RUN_DIR_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN="true"; shift ;;
    --run-dir)  RUN_DIR_OVERRIDE="$2"; shift 2 ;;
    --root)     ROOT="$2"; shift 2 ;;
    *) echo "Usage: runner-llm-desc-validation.sh [--dry-run] [--run-dir <path>] [--root <path>]"; exit 1 ;;
  esac
done

export DRY_RUN

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [ -n "$RUN_DIR_OVERRIDE" ]; then
  RUN_DIR="$RUN_DIR_OVERRIDE"
else
  RUN_DIR="$ROOT/tmp/graphify-v23-llm-desc-validation-$TIMESTAMP"
fi

# Source des candidats v23a (run précédent : 64/76 publishés, 12 bloqués missing_desc)
CANDIDATES_BASE="$ROOT/tmp/graphify-v23-v23a-publish-20260619T005818Z/workers"

GATE_SH="$SCRIPT_DIR/gate.sh"
WORKER_LLM_SH="$SCRIPT_DIR/worker-llm-descriptions.sh"

# ── 12 villes cibles ──────────────────────────────────────────────────────────
CITIES=(
  saint-felix-de-valois
  saint-cuthbert
  les-eboulements
  gaspe
  stanbridge-east
  saint-ubalde
  lascension-de-notre-seigneur
  sainte-agathe-des-monts
  saint-jude
  senneville
  windsor
  montreal-est
)

mkdir -p "$RUN_DIR/status" "$RUN_DIR/logs" "$RUN_DIR/workers"

STATUS_FILE="$RUN_DIR/status/central.jsonl"

echo "=== Runner LLM descriptions (étape b — validation 12 villes) ==="
echo "Run dir    : $RUN_DIR"
echo "Dry-run    : $DRY_RUN"
echo "Modèle LLM : claude-sonnet-4-6"
echo "Started    : $TIMESTAMP"
echo "Cibles     : ${#CITIES[@]}"
echo ""

# ── Preflight SCW ─────────────────────────────────────────────────────────────
echo "--- PREFLIGHT SCW ---"

# shellcheck source=/dev/null
source "$ROOT/.env" 2>/dev/null || true
unset -v AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_SESSION_TOKEN 2>/dev/null || true
export AWS_ACCESS_KEY_ID="${SCRAPE_S3_ACCESS_KEY:-}"
export AWS_SECRET_ACCESS_KEY="${SCRAPE_S3_SECRET_KEY:-}"
export AWS_REGION="${SCRAPE_S3_REGION:-}"
S3_URL="${SCRAPE_S3_ENDPOINT:-}"
BUCKET="${SCRAPE_S3_BUCKET:-}"

if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ -z "$S3_URL" ] || [ -z "$BUCKET" ]; then
  echo "PREFLIGHT KO: credentials SCW manquants (.env)" >&2
  exit 1
fi

if ! s5cmd --endpoint-url "$S3_URL" ls "s3://$BUCKET/graph/" >/tmp/runner-llm-preflight.log 2>&1; then
  echo "PREFLIGHT KO: SCW inaccessible en lecture — voir /tmp/runner-llm-preflight.log" >&2
  exit 1
fi

probe_key="s3://$BUCKET/_preflight-llm-runner-$(date +%s).txt"
echo "probe" > /tmp/runner-llm-probe.txt
if ! s5cmd --endpoint-url "$S3_URL" cp /tmp/runner-llm-probe.txt "$probe_key" >/tmp/runner-llm-preflight-write.log 2>&1; then
  echo "PREFLIGHT KO: SCW inaccessible en écriture — voir /tmp/runner-llm-preflight-write.log" >&2
  exit 1
fi
s5cmd --endpoint-url "$S3_URL" rm "$probe_key" >/dev/null 2>&1 || true
rm -f /tmp/runner-llm-probe.txt

echo "  [OK] SCW credentials + R/W"
echo ""

# ── Traitement séquentiel des 12 villes ───────────────────────────────────────
echo "--- EXTRACTION LLM + GATE ---"

published_count=0
validated_count=0
blocked_count=0

for city in "${CITIES[@]}"; do
  city_work="$RUN_DIR/workers/$city"
  mkdir -p "$city_work"

  echo ""
  echo "  [$city]"

  # Source : candidat du run v23a
  src_candidate="$CANDIDATES_BASE/$city/latest.v23.json"
  if [ ! -f "$src_candidate" ]; then
    echo "  [BLOCKED] $city: candidat source absent ($src_candidate)"
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    jq -cn \
      --arg city "$city" --arg ts "$ts" \
      '{city:$city,status:"blocked",lane:"llm-validation",reason:"source_candidate_missing",validatedExtraction:false,published:false,oldSignals:0,oldEvents:0,newSignals:0,newEvents:0,nodes:0,edges:0,startedAt:$ts,finishedAt:$ts}' \
      >> "$STATUS_FILE"
    printf '\n' >> "$STATUS_FILE"
    blocked_count=$((blocked_count + 1))
    continue
  fi

  # Récupérer la baseline depuis SCW
  baseline="$city_work/baseline.json"
  if ! s5cmd --endpoint-url "$S3_URL" cat "s3://$BUCKET/graph/$city/latest.json" > "$baseline" 2>"$city_work/baseline.log"; then
    echo "  [BLOCKED] $city: baseline SCW introuvable"
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    jq -cn \
      --arg city "$city" --arg ts "$ts" \
      '{city:$city,status:"blocked",lane:"llm-validation",reason:"baseline_missing",validatedExtraction:false,published:false,oldSignals:0,oldEvents:0,newSignals:0,newEvents:0,nodes:0,edges:0,startedAt:$ts,finishedAt:$ts}' \
      >> "$STATUS_FILE"
    printf '\n' >> "$STATUS_FILE"
    blocked_count=$((blocked_count + 1))
    continue
  fi

  # Worker LLM: enrichir les descriptions manquantes
  enriched_candidate="$city_work/latest.v23.json"
  worker_log="$city_work/worker-llm.log"

  llm_flag=""
  [ "$DRY_RUN" = "true" ] && llm_flag="--dry-run"

  if ! bash "$WORKER_LLM_SH" "$src_candidate" "$enriched_candidate" $llm_flag > "$worker_log" 2>&1; then
    echo "  [BLOCKED] $city: worker-llm failed (voir $worker_log)"
    cat "$worker_log" | tail -5 >&2
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    jq -cn \
      --arg city "$city" --arg ts "$ts" \
      '{city:$city,status:"blocked",lane:"llm-validation",reason:"worker_llm_failed",validatedExtraction:false,published:false,oldSignals:0,oldEvents:0,newSignals:0,newEvents:0,nodes:0,edges:0,startedAt:$ts,finishedAt:$ts}' \
      >> "$STATUS_FILE"
    printf '\n' >> "$STATUS_FILE"
    blocked_count=$((blocked_count + 1))
    continue
  fi

  cat "$worker_log"

  # Gate central: validation + publish
  if bash "$GATE_SH" "$city" "$enriched_candidate" "$baseline" "$RUN_DIR" "llm-validation" >> "$city_work/gate.log" 2>&1; then
    echo "  [DONE] $city: publié"
    published_count=$((published_count + 1))
    validated_count=$((validated_count + 1))
  else
    gate_reason=$(tail -5 "$city_work/gate.log" 2>/dev/null || echo "gate_failed")
    echo "  [PARTIAL] $city: gate bloqué — $gate_reason"
    # Lire le statut depuis le JSONL si disponible
    if [ -s "$STATUS_FILE" ]; then
      last_status=$(grep "\"$city\"" "$STATUS_FILE" | tail -1 | jq -r '.reason // "gate_blocked"' 2>/dev/null || echo "gate_blocked")
      echo "  reason: $last_status"
    fi
    blocked_count=$((blocked_count + 1))
  fi

done

# ── Métriques ─────────────────────────────────────────────────────────────────
echo ""
echo "--- MÉTRIQUES FINALES ---"

METRICS_FILE="$RUN_DIR/metrics.json"
if [ -s "$STATUS_FILE" ]; then
  METRICS=$(jq -s '
    map(select(type=="object" and has("city"))) |
    group_by(.city) | map(last) as $latest |
    {
      assigned: ($latest|length),
      published: ($latest|map(select(.published==true))|length),
      validated: ($latest|map(select(.validatedExtraction==true))|length),
      done: ($latest|map(select(.status=="done"))|length),
      blocked: ($latest|map(select(.status=="blocked" or .status=="partial"))|length),
      regressions: ($latest|map(select(.reason | tostring | startswith("signal_or_event_regression")))|length),
      topReasons: ($latest|map(select(.reason != "" and .reason != null))|group_by(.reason)|map({reason: .[0].reason, count: length})|sort_by(-.count))
    }
  ' "$STATUS_FILE")
  echo "$METRICS" > "$METRICS_FILE"
  echo "$METRICS"
else
  echo '{"assigned":0,"published":0}' > "$METRICS_FILE"
fi

echo ""
echo "=== Runner LLM terminé : $RUN_DIR ==="
echo "published=$published_count/12, validated=$validated_count, blocked=$blocked_count"
