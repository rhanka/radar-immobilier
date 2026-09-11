#!/usr/bin/env bash
# runner.sh — runner central déterministe graphify v2.3
# Usage: runner.sh [--dry-run] [--sample <n>] [--run-dir <path>] [--targets <tsv>] [--manifest <tsv>]
#
# --dry-run         : valide tout, skip l'upload final vers graph/<city>/latest.json
# --sample <n>      : limite à n premières villes (test)
# --run-dir <path>  : chemin du run (défaut: tmp/graphify-v23-runner-<timestamp>)
#
# Architecture:
#   1. Preflight (fail fast)
#   2. Dispatch équilibré en 8 lanes (round-robin)
#   3. Pour chaque ville : worker → candidat → gate/publish central
#   4. Métriques par lot
#   5. Rapport final
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ROOT : répertoire d'invocation du script (PWD), ou --root <path> si fourni.
# Cela permet d'appeler: cd /repo && bash tools/graphify-v23/runner.sh
ROOT="${PWD}"

# ── Parsing args ─────────────────────────────────────────────────────────────
DRY_RUN="false"
SAMPLE=""
RUN_DIR_OVERRIDE=""
TARGETS_OVERRIDE=""
MANIFEST_OVERRIDE=""
MANIFEST_SINCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN="true"; shift ;;
    --sample)    SAMPLE="$2"; shift 2 ;;
    --run-dir)   RUN_DIR_OVERRIDE="$2"; shift 2 ;;
    --root)    ROOT="$2"; shift 2 ;;
    --targets) TARGETS_OVERRIDE="$2"; shift 2 ;;
    --manifest) MANIFEST_OVERRIDE="$2"; shift 2 ;;
    --manifest-since) MANIFEST_SINCE="$2"; shift 2 ;;
    *) echo "Usage: runner.sh [--dry-run] [--sample <n>] [--run-dir <path>] [--root <path>] [--targets <tsv>] [--manifest <tsv>]"; exit 1 ;;
  esac
done

export DRY_RUN

# ── Paths ─────────────────────────────────────────────────────────────────────
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [ -n "$RUN_DIR_OVERRIDE" ]; then
  RUN_DIR="$RUN_DIR_OVERRIDE"
else
  RUN_DIR="$ROOT/tmp/graphify-v23-runner-$TIMESTAMP"
fi

RERUN_TARGETS="${TARGETS_OVERRIDE:-$ROOT/tmp/graphify-v23-headless-20260618T131516/rerun-targets-final.tsv}"
BASELINE_DIR="$ROOT/tmp/graphify-v23-rerun-sessions-20260618T173454/parts/lane-01-baselines"
STATUS_FILE="$RUN_DIR/status/central.jsonl"
METRICS_FILE="$RUN_DIR/metrics.json"
REPORT_FILE="$RUN_DIR/report.md"

GATE_SH="$SCRIPT_DIR/gate.sh"
WORKER_SH="$SCRIPT_DIR/worker.sh"
PREFLIGHT_SH="$SCRIPT_DIR/preflight.sh"
MANIFEST_SH="$SCRIPT_DIR/build-cas-manifest.sh"
EXCLUSIONS="$SCRIPT_DIR/cas-exclusions.tsv"

TARGET_LAYOUT="legacy"
if IFS=$'\t' read -r header_1 header_2 header_3 _rest < "$RERUN_TARGETS"; then
  if [ "$header_1" = "source_id" ] && [ "$header_2" = "city_slug" ] && [ "$header_3" = "new_docs" ]; then
    TARGET_LAYOUT="cas"
  fi
fi

mkdir -p "$RUN_DIR/status" "$RUN_DIR/logs" "$RUN_DIR/workers" "$RUN_DIR/lanes"

echo "=== Runner graphify v2.3 ==="
echo "Run dir    : $RUN_DIR"
echo "Dry-run    : $DRY_RUN"
echo "Sample     : ${SAMPLE:-all}"
echo "Started    : $TIMESTAMP"
echo "Targets    : $TARGET_LAYOUT"
echo ""

# ── Credentials stay process-local and are never printed ─────────────────────
set -a
# shellcheck source=/dev/null
if [ -f "$ROOT/.env" ]; then
  source "$ROOT/.env"
fi
unset -v AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_SESSION_TOKEN 2>/dev/null || true
export AWS_ACCESS_KEY_ID="${SCRAPE_S3_ACCESS_KEY:-}"
export AWS_SECRET_ACCESS_KEY="${SCRAPE_S3_SECRET_KEY:-}"
export AWS_REGION="${SCRAPE_S3_REGION:-}"
set +a

# ── 1. Preflight ──────────────────────────────────────────────────────────────
echo "--- PREFLIGHT ---"
preflight_mode=""
if [ "$DRY_RUN" = "true" ]; then
  preflight_mode="--dry-run"
fi
if ! GRAPHIFY_TARGETS="$RERUN_TARGETS" bash "$PREFLIGHT_SH" "$ROOT" "$preflight_mode"; then
  echo "PREFLIGHT KO — arrêt."
  exit 1
fi
echo ""

# ── 1b. Freeze or reuse the immutable CAS manifest ───────────────────────────
CAS_MANIFEST=""
CAS_MANIFEST_SHA=""
LLM_COUNTER="$RUN_DIR/llm-calls.count"
if [ "$TARGET_LAYOUT" = "cas" ]; then
  if [ "$DRY_RUN" != "true" ] && [ -z "$MANIFEST_OVERRIDE" ]; then
    echo "REFUS publish: --manifest from an accepted dry-run is required." >&2
    exit 1
  fi
  CAS_MANIFEST="$RUN_DIR/cas-manifest.tsv"
  if [ -z "$MANIFEST_SINCE" ]; then
    target_meta="${RERUN_TARGETS}.meta"
    manifest_date=$(awk '/^window: LastModified >= / {print $4; exit}' "$target_meta" 2>/dev/null || true)
    MANIFEST_SINCE="${manifest_date:-2026-09-11}T00:00:00Z"
  fi
  bash "$MANIFEST_SH" "$RERUN_TARGETS" "$CAS_MANIFEST" "$MANIFEST_SINCE" "$MANIFEST_OVERRIDE"
  CAS_MANIFEST_SHA=$(sha256sum "$CAS_MANIFEST" | awk '{print $1}')
  planned_docs=$(awk 'END {print NR-1}' "$CAS_MANIFEST")
  planned_max_calls=$((planned_docs * 2))
  if [ "$planned_max_calls" -gt 500 ]; then
    echo "REFUS LLM: worst-case $planned_max_calls calls exceeds cap 500." >&2
    exit 1
  fi
  [ -f "$LLM_COUNTER" ] || printf '0\n' > "$LLM_COUNTER"
  echo "CAS manifest: $planned_docs documents (max $planned_max_calls LLM attempts)"
fi

# ── 2. Charger les cibles ─────────────────────────────────────────────────────
echo "--- DISPATCH ---"

# Lire le TSV (skip header), extraire city + chercher baseline
declare -a CITIES=()
declare -A CITY_SOURCE_ID=()
declare -A CITY_EXPECTED_DOCS=()

# Sources de baselines : d'abord le répertoire local, sinon SCW à la volée
get_baseline() {
  local city="$1"
  local local_bl="$BASELINE_DIR/${city}.json"
  if [ -f "$local_bl" ]; then
    echo "$local_bl"
    return 0
  fi
  # Télécharger depuis SCW si absent localement
  local remote_bl="$RUN_DIR/baselines/${city}.json"
  mkdir -p "$RUN_DIR/baselines"
  if s5cmd --endpoint-url "$SCRAPE_S3_ENDPOINT" cat "s3://$SCRAPE_S3_BUCKET/graph/${city}/latest.json" > "$remote_bl" 2>/dev/null; then
    echo "$remote_bl"
    return 0
  fi
  echo ""
  return 1
}

# Charger cibles avec leur candidat existant si disponible
declare -A CITY_EXISTING_CANDIDATE=()
if [ "$TARGET_LAYOUT" = "cas" ]; then
  while IFS=$'\t' read -r source_id city expected _rest; do
    [ "$source_id" = "source_id" ] && continue
    [ -z "$city" ] && continue
    CITIES+=("$city")
    CITY_SOURCE_ID["$city"]="$source_id"
    CITY_EXPECTED_DOCS["$city"]="$expected"
  done < "$RERUN_TARGETS"
else
  while IFS=$'\t' read -r lane city status reason validated published expected_local _rest; do
    [ "$lane" = "lane" ] && continue
    [ -z "$city" ] && continue
    CITIES+=("$city")
    if [ -n "$expected_local" ] && [ -f "$ROOT/$expected_local" ]; then
      CITY_EXISTING_CANDIDATE["$city"]="$ROOT/$expected_local"
    fi
  done < "$RERUN_TARGETS"
fi

total="${#CITIES[@]}"
echo "Total cibles: $total"

# Appliquer le sample si demandé
if [ -n "$SAMPLE" ] && [ "$SAMPLE" -lt "$total" ]; then
  CITIES=("${CITIES[@]:0:$SAMPLE}")
  total="$SAMPLE"
  echo "Sample limité à $total villes"
fi

# Dispatch round-robin en 8 lanes
N_LANES=8
declare -a LANE_FILES=()
for i in $(seq 1 $N_LANES); do
  lf="$RUN_DIR/lanes/lane-$(printf '%02d' $i).txt"
  : > "$lf"
  LANE_FILES+=("$lf")
done

idx=0
for city in "${CITIES[@]}"; do
  lane_idx=$((idx % N_LANES))
  echo "$city" >> "${LANE_FILES[$lane_idx]}"
  idx=$((idx + 1))
done

for i in $(seq 1 $N_LANES); do
  lf="${LANE_FILES[$((i-1))]}"
  cnt=$(wc -l < "$lf" 2>/dev/null || echo 0)
  echo "  lane-$(printf '%02d' $i): $cnt villes"
done
echo ""

# ── 3. Traitement séquentiel (dans chaque lane, villes en séquence) ────────────
echo "--- EXTRACTION + GATE ---"

assigned=0
published_count=0
validated_count=0
blocked_count=0
partial_count=0
done_count=0

process_city() {
  local city="$1"
  local lane_id="$2"
  local city_work="$RUN_DIR/workers/$city"
  mkdir -p "$city_work"

  local baseline
  baseline=$(get_baseline "$city") || baseline=""

  if [ -z "$baseline" ]; then
    # Écrire status blocked dans le fichier central
    local ts; ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    jq -cn \
      --arg city "$city" --arg lane "$lane_id" --arg ts "$ts" \
      '{city:$city,status:"blocked",lane:$lane,reason:"baseline_missing",validatedExtraction:false,published:false,oldSignals:0,oldEvents:0,newSignals:0,newEvents:0,nodes:0,edges:0,startedAt:$ts,finishedAt:$ts}' \
      >> "$STATUS_FILE"
    printf '\n' >> "$STATUS_FILE"
    echo "[runner] $city: baseline_missing"
    return 1
  fi

  # Chercher d'abord un candidat existant (du run baseline) avant de lancer le worker
  local candidate="$city_work/latest.v23.json"
  local existing_candidate="${CITY_EXISTING_CANDIDATE[$city]:-}"

  if [ -n "$existing_candidate" ] && [ -f "$existing_candidate" ]; then
    # Réutiliser le candidat existant (évite de relancer le build/transform)
    cp "$existing_candidate" "$candidate"
    echo "[runner] $city: candidat existant réutilisé ($existing_candidate)"
  else
    # Worker: produit le candidat
    local source_id="${CITY_SOURCE_ID[$city]:-}"
    if ! bash "$WORKER_SH" "$city" "$baseline" "$city_work" "$ROOT" "$source_id" \
      "$CAS_MANIFEST" "$LLM_COUNTER" "$EXCLUSIONS" > "$city_work/worker.stdout.log" 2>&1; then
      local worker_reason
      worker_reason=$(tail -1 "$city_work/worker.stdout.log" 2>/dev/null | awk -F': ' '{print $NF}')
      [ -n "$worker_reason" ] || worker_reason="worker_failed"
      local ts; ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
      local oldS oldE
      oldS=$(jq '[.nodes[]? | select(.type=="Signal")] | length' "$baseline" 2>/dev/null || echo 0)
      oldE=$(jq '[.nodes[]? | select(.type=="DesignationEvent")] | length' "$baseline" 2>/dev/null || echo 0)
      jq -cn \
        --arg city "$city" --arg lane "$lane_id" --arg reason "$worker_reason" --arg ts "$ts" \
        --argjson oldSignals "$oldS" --argjson oldEvents "$oldE" \
        '{city:$city,status:"blocked",lane:$lane,reason:$reason,validatedExtraction:false,published:false,oldSignals:$oldSignals,oldEvents:$oldEvents,newSignals:0,newEvents:0,nodes:0,edges:0,startedAt:$ts,finishedAt:$ts}' \
        >> "$STATUS_FILE"
      printf '\n' >> "$STATUS_FILE"
      echo "[runner] $city: worker failed ($worker_reason)"
      return 1
    fi

    if [ ! -f "$candidate" ]; then
      echo "[runner] $city: candidat manquant après worker" >&2
      return 1
    fi
  fi

  # Gate central: validation + publish
  local cas_metrics="$city_work/cas-metrics.json"
  CAS_MANIFEST_SHA="$CAS_MANIFEST_SHA" GRAPHIFY_EXCLUSIONS="$EXCLUSIONS" \
    CAS_METRICS="$cas_metrics" bash "$GATE_SH" "$city" "$candidate" "$baseline" "$RUN_DIR" "$lane_id"
}

# Lancer les lanes séquentiellement (pas en parallèle — évite OOM)
for i in $(seq 1 $N_LANES); do
  lf="${LANE_FILES[$((i-1))]}"
  lane_id="lane-$(printf '%02d' $i)"
  echo ""
  echo "--- $lane_id ---"

  while IFS= read -r city; do
    [ -z "$city" ] && continue
    assigned=$((assigned + 1))
    process_city "$city" "$lane_id" || true
  done < "$lf"
done

# ── 4. Métriques finales ──────────────────────────────────────────────────────
echo ""
echo "--- MÉTRIQUES ---"

if [ -s "$STATUS_FILE" ]; then
  METRICS=$(jq -s '
    map(select(type=="object" and has("city"))) |
    group_by(.city) | map(last) as $latest |
    {
      assigned: ($latest|length),
      published: ($latest|map(select(.published==true))|length),
      validated: ($latest|map(select(.validatedExtraction==true))|length),
      done: ($latest|map(select(.status=="done"))|length),
      partial: ($latest|map(select(.status=="partial"))|length),
      blocked: ($latest|map(select(.status=="blocked"))|length),
      topReasons: ($latest|map(select(.reason != "" and .reason != null))|group_by(.reason)|map({reason: .[0].reason, count: length})|sort_by(-.count)|.[0:12]),
      regressions: ($latest|map(select(.reason | tostring | startswith("signal_or_event_regression")))|length)
      ,oldSignals: ($latest|map(.oldSignals)|add // 0)
      ,newSignals: ($latest|map(.newSignals)|add // 0)
      ,oldEvents: ($latest|map(.oldEvents)|add // 0)
      ,newEvents: ($latest|map(.newEvents)|add // 0)
      ,freshSignals: ($latest|map(.freshSignals // 0)|add // 0)
      ,freshEvents: ($latest|map(.freshEvents // 0)|add // 0)
      ,documentsExpected: ($latest|map(.documentsExpected // 0)|add // 0)
      ,documentsVerified: ($latest|map(.documentsVerified // 0)|add // 0)
    }
  ' "$STATUS_FILE")

  echo "$METRICS" > "$METRICS_FILE"
  echo "$METRICS"
else
  echo "{\"assigned\":0,\"published\":0,\"validated\":0}" > "$METRICS_FILE"
  echo "Aucun résultat."
fi
if [ -f "$LLM_COUNTER" ]; then
  llm_calls=$(cat "$LLM_COUNTER")
  METRICS=$(jq --argjson calls "$llm_calls" '. + {llmCalls:$calls,descriptionCalls:0}' "$METRICS_FILE")
  echo "$METRICS" > "$METRICS_FILE"
fi

# ── 5. Rapport final ─────────────────────────────────────────────────────────
cat > "$REPORT_FILE" << EOF_REPORT
# Graphify v2.3 runner — rapport $TIMESTAMP

- dry_run: $DRY_RUN
- sample: ${SAMPLE:-all}
- run_dir: $RUN_DIR

## Métriques

$(cat "$METRICS_FILE" 2>/dev/null || echo "N/A")

## Commande prod complète (sans --dry-run, sans --sample)

\`\`\`bash
cd $ROOT
bash tools/graphify-v23/runner.sh --targets $RERUN_TARGETS --manifest $CAS_MANIFEST
\`\`\`

## Commande dry-run

\`\`\`bash
cd $ROOT
bash tools/graphify-v23/runner.sh --dry-run
\`\`\`
EOF_REPORT

echo ""
echo "=== Runner terminé : $RUN_DIR ==="
echo "Rapport: $REPORT_FILE"
