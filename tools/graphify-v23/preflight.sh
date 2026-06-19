#!/usr/bin/env bash
# preflight.sh — vérifications avant tout batch v2.3
# Usage: preflight.sh <root_dir> [--dry-run]
# Exit 0 si tout OK, 1 avec détail si KO
set -euo pipefail

ROOT="${1:?root_dir requis}"
DRY_RUN="${2:-}"

GRAPHIFY_CLI="$ROOT/node_modules/.bin/graphify"
ONTOLOGY_PROFILE="$ROOT/radar/ontology/ontology-profile.yaml"
RERUN_TARGETS="$ROOT/tmp/graphify-v23-headless-20260618T131516/rerun-targets-final.tsv"
BASELINE_DIR="$ROOT/tmp/graphify-v23-rerun-sessions-20260618T173454/parts/lane-01-baselines"
REFS_DIR="$ROOT/tmp/graphify-v23-cli-20260618-1155/worker/agent-04/test-aguanish/references"
GRAPHIFY_TO_EXTRACTION="/tmp/graphify_to_extraction_v23.js"
EXTRACTION_TO_GRAPH="/tmp/extraction_to_v23_graph.js"

ok=0
fail=0

check() {
  local label="$1"
  local result="$2"
  if [[ "$result" == OK* ]]; then
    echo "  [OK] $label"
    ok=$((ok+1))
  else
    echo "  [FAIL] $label : $result"
    fail=$((fail+1))
  fi
}

echo "=== Preflight graphify v2.3 runner ==="
echo "Root: $ROOT"
echo ""

# ── 1. SCW credentials ────────────────────────────────────────────────────────
source "$ROOT/.env" 2>/dev/null || true
export AWS_ACCESS_KEY_ID="${SCRAPE_S3_ACCESS_KEY:-}"
export AWS_SECRET_ACCESS_KEY="${SCRAPE_S3_SECRET_KEY:-}"
export AWS_REGION="${SCRAPE_S3_REGION:-}"
S3_URL="${SCRAPE_S3_ENDPOINT:-}"
BUCKET="${SCRAPE_S3_BUCKET:-}"

if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ -z "$S3_URL" ] || [ -z "$BUCKET" ]; then
  check "SCW credentials" "MISSING (vérifie .env)"
else
  check "SCW credentials" "OK"
fi

# ── 2. s5cmd ─────────────────────────────────────────────────────────────────
if command -v s5cmd >/dev/null 2>&1; then
  check "s5cmd" "OK ($(s5cmd --version 2>&1 | head -1))"
else
  check "s5cmd" "NOT FOUND"
fi

# ── 3. SCW read ───────────────────────────────────────────────────────────────
if s5cmd --endpoint-url "$S3_URL" ls "s3://$BUCKET/graph/" >/tmp/preflight-read.log 2>&1; then
  graph_count=$(wc -l < /tmp/preflight-read.log 2>/dev/null || echo 0)
  check "SCW read (graph/)" "OK ($graph_count entrées)"
else
  check "SCW read (graph/)" "FAILED (voir /tmp/preflight-read.log)"
fi

# ── 4. SCW write ──────────────────────────────────────────────────────────────
probe_key="s3://$BUCKET/_preflight-runner-probe-$(date +%s).txt"
echo "preflight" > /tmp/preflight-probe.txt
if s5cmd --endpoint-url "$S3_URL" cp /tmp/preflight-probe.txt "$probe_key" >/tmp/preflight-write.log 2>&1; then
  s5cmd --endpoint-url "$S3_URL" rm "$probe_key" >/dev/null 2>&1 || true
  check "SCW write" "OK"
else
  check "SCW write" "FAILED (voir /tmp/preflight-write.log)"
fi
rm -f /tmp/preflight-probe.txt

# ── 5. Graphify CLI ───────────────────────────────────────────────────────────
if [ -x "$GRAPHIFY_CLI" ]; then
  version=$("$GRAPHIFY_CLI" --version 2>&1 || echo "erreur")
  check "graphify CLI" "OK (v$version)"
else
  check "graphify CLI" "NOT FOUND ($GRAPHIFY_CLI)"
fi

# ── 6. Ontology profile ───────────────────────────────────────────────────────
if [ -f "$ONTOLOGY_PROFILE" ]; then
  check "ontology profile" "OK"
else
  check "ontology profile" "MISSING ($ONTOLOGY_PROFILE)"
fi

# ── 7. JS transforms ─────────────────────────────────────────────────────────
if [ -f "$GRAPHIFY_TO_EXTRACTION" ]; then
  check "graphify_to_extraction_v23.js" "OK"
else
  check "graphify_to_extraction_v23.js" "MISSING ($GRAPHIFY_TO_EXTRACTION)"
fi

if [ -f "$EXTRACTION_TO_GRAPH" ]; then
  check "extraction_to_v23_graph.js" "OK"
else
  check "extraction_to_v23_graph.js" "MISSING ($EXTRACTION_TO_GRAPH)"
fi

# ── 8. Rerun targets ──────────────────────────────────────────────────────────
if [ -f "$RERUN_TARGETS" ]; then
  target_count=$(tail -n +2 "$RERUN_TARGETS" | wc -l)
  check "rerun-targets-final.tsv" "OK ($target_count cibles)"
else
  check "rerun-targets-final.tsv" "MISSING ($RERUN_TARGETS)"
fi

# ── 9. Baselines directory ────────────────────────────────────────────────────
if [ -d "$BASELINE_DIR" ]; then
  baseline_count=$(ls "$BASELINE_DIR"/*.json 2>/dev/null | wc -l || echo 0)
  check "baselines directory" "OK ($baseline_count fichiers)"
else
  check "baselines directory" "MISSING ($BASELINE_DIR)"
fi

# ── 10. Références CSV ───────────────────────────────────────────────────────
for csv in municipalities.csv cadastre.csv adresses_qc.csv; do
  if [ -f "$REFS_DIR/$csv" ]; then
    check "refs/$csv" "OK"
  else
    check "refs/$csv" "MISSING ($REFS_DIR/$csv)"
  fi
done

# ── 11. Dry-run publish sur 1 ville déjà publiée ─────────────────────────────
# Utiliser abercorn (v2.2 connue, non dans rerun-targets si elle est done)
DRY_CITY="abercorn"
DRY_WORK="/tmp/preflight-drydryrun-$DRY_CITY"
mkdir -p "$DRY_WORK"

if s5cmd --endpoint-url "$S3_URL" cat "s3://$BUCKET/graph/$DRY_CITY/latest.json" > "$DRY_WORK/latest.old.json" 2>/tmp/preflight-drydl.log; then
  # Simuler un graphe v2.3 minimal valide depuis la baseline
  existing_signals=$(jq '[.nodes[]? | select(.type=="Signal")] | length' "$DRY_WORK/latest.old.json" 2>/dev/null || echo 0)
  # Créer un candidat de test qui prétend être v2.3 (sans LLM — juste la forme)
  jq --arg city "$DRY_CITY" '. + {ontology_version: "2.3", municipality: $city}' \
    "$DRY_WORK/latest.old.json" > "$DRY_WORK/latest.v23.json" 2>/dev/null || true

  # S'assurer que description non vide sur tous les signaux pour ce test de forme
  # (on modifie la copie locale, pas le SCW)
  jq 'walk(if type == "object" and (.type == "Signal" or .type == "DesignationEvent") then .properties.description = (.properties.description // .label // "signal") else . end)' \
    "$DRY_WORK/latest.v23.json" > "$DRY_WORK/latest.v23.patched.json" 2>/dev/null && mv "$DRY_WORK/latest.v23.patched.json" "$DRY_WORK/latest.v23.json"

  # Dry-run: upload vers parsed/ uniquement (pas graph/)
  parsed_probe="s3://$BUCKET/parsed/$DRY_CITY/graphify-v2.3/_preflight-dry-$(date +%s).json"
  if s5cmd --endpoint-url "$S3_URL" cp "$DRY_WORK/latest.v23.json" "$parsed_probe" >/tmp/preflight-publish-dry.log 2>&1; then
    s5cmd --endpoint-url "$S3_URL" rm "$parsed_probe" >/dev/null 2>&1 || true
    check "dry-run publish chemin parsed/" "OK (upload+cleanup réussi pour $DRY_CITY)"
  else
    check "dry-run publish chemin parsed/" "FAILED (voir /tmp/preflight-publish-dry.log)"
  fi
else
  check "dry-run publish chemin parsed/" "SKIPPED (impossible de lire $DRY_CITY depuis SCW)"
fi

# ── Résumé ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Résumé preflight : $ok OK, $fail FAIL ==="

if [ "$fail" -gt 0 ]; then
  echo "PREFLIGHT KO — corriger les $fail points avant de lancer le runner"
  exit 1
else
  echo "PREFLIGHT OK — prêt à lancer runner.sh"
  exit 0
fi
