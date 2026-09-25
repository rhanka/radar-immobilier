#!/usr/bin/env bash
# worker.sh — worker v2.3 : baseline + semantic CAS extraction (never publishes)
# Usage: worker.sh <city> <baseline> <work_dir> <root> [source_id manifest counter exclusions]
# Produit: <work_dir>/latest.v23.json (candidat) ou exit 1
#
set -euo pipefail

CITY="${1:?city requis}"
BASELINE="${2:?baseline_json requis}"
WORK_DIR="${3:?work_dir requis}"
ROOT="${4:?root_dir requis}"
SOURCE_ID="${5:-}"
CAS_MANIFEST="${6:-}"
LLM_COUNTER="${7:-}"
EXCLUSIONS="${8:-$ROOT/tools/graphify-v23/cas-exclusions.tsv}"

GRAPHIFY_CLI="${GRAPHIFY_CLI:-$ROOT/node_modules/.bin/graphify}"
SCRIPT_BASE="${GRAPHIFY_REFS_DIR:-$ROOT/tmp/graphify-v23-cli-20260618-1155/worker/agent-04/test-aguanish/references}"
ONTOLOGY_PROFILE="$ROOT/radar/ontology/ontology-profile.yaml"

GRAPHIFY_TO_EXTRACTION="$ROOT/tools/graphify-v23/graphify_to_extraction_v23.js"
EXTRACTION_TO_GRAPH="$ROOT/tools/graphify-v23/extraction_to_v23_graph.js"
MERGE_EXTRACTIONS="$ROOT/tools/graphify-v23/merge_extractions_v23.js"
FINDINGS_TO_EXTRACTION="$ROOT/tools/graphify-v23/cas_findings_to_extraction_v23.js"
APPLY_EXCLUSIONS="$ROOT/tools/graphify-v23/apply_exclusions_v23.js"
FINDINGS_SCHEMA="$ROOT/tools/graphify-v23/cas-findings.schema.json"
EXTRACTION_PROMPT="$ROOT/tools/graphify-v23/cas-extraction-prompt.md"
DOWNLOAD_CAS="$ROOT/tools/graphify-v23/download-cas-corpus.sh"
EXTRACT_CAS="$ROOT/tools/graphify-v23/extract-cas-semantic.sh"

# Fallback: utiliser les versions dans /tmp si absentes du repo
if [ ! -f "$GRAPHIFY_TO_EXTRACTION" ]; then
  GRAPHIFY_TO_EXTRACTION="/tmp/graphify_to_extraction_v23.js"
fi
if [ ! -f "$EXTRACTION_TO_GRAPH" ]; then
  EXTRACTION_TO_GRAPH="/tmp/extraction_to_v23_graph.js"
fi

mkdir -p "$WORK_DIR/corpus" "$WORK_DIR/findings" "$WORK_DIR/parsed/$CITY"
printf '!*.txt\n!*.html\n!*.pdf\n' > "$WORK_DIR/corpus/.graphifyignore"

local_extraction="$WORK_DIR/extraction.v23.json"
baseline_extraction="$WORK_DIR/extraction.baseline.v23.json"
fresh_extraction="$WORK_DIR/extraction.cas.v23.json"
local_validation="$WORK_DIR/validation.json"
local_graphify_yaml="$WORK_DIR/graphify.yaml"
latest_candidate_raw="$WORK_DIR/latest.generated.v23.json"
latest_candidate="$WORK_DIR/latest.v23.json"
clean_script="$WORK_DIR/clean-generated-refs.mjs"
LOG="$WORK_DIR/worker.log"
docs_expected=0
docs_verified=0
calls_at_start=0
calls_at_end=0

# ── 1. Vérifier le baseline ───────────────────────────────────────────────────
if [ ! -f "$BASELINE" ]; then
  echo "[worker] $CITY: baseline manquant ($BASELINE)" >&2
  exit 1
fi

if [ -n "$SOURCE_ID" ]; then
  if [ ! -f "$CAS_MANIFEST" ] || [ ! -f "$LLM_COUNTER" ]; then
    echo "[worker] $CITY: cas_contract_missing" >&2
    exit 1
  fi
  node "$APPLY_EXCLUSIONS" "$BASELINE" "$CITY" "$EXCLUSIONS" "$WORK_DIR/latest.old.json" >> "$LOG" 2>&1
else
  cp "$BASELINE" "$WORK_DIR/latest.old.json"
fi

pv_count=$(jq -r '.pv_count // 0' "$BASELINE" 2>/dev/null || echo 0)
ontology_version=$(jq -r '.ontology_version // ""' "$BASELINE" 2>/dev/null || true)
# Accepter baselines 2.1, 2.2 et 2.3 (re-run sur villes déjà partiellement traitées)
if [ -n "$ontology_version" ] && [ "$ontology_version" != "2.1" ] && [ "$ontology_version" != "2.2" ] && [ "$ontology_version" != "2.3" ]; then
  echo "[worker] $CITY: baseline ontology_version=$ontology_version inattendu" >&2
  exit 1
fi

# ── 2. Écrire graphify.yaml ───────────────────────────────────────────────────
cat > "$local_graphify_yaml" << EOF_YML
version: 1
profile:
  path: ${ONTOLOGY_PROFILE}
inputs:
  corpus:
    - "${WORK_DIR}/corpus"
    - "${WORK_DIR}/parsed/${CITY}"
  registries:
    - ${SCRIPT_BASE}/municipalities.csv
    - ${SCRIPT_BASE}/cadastre.csv
    - ${SCRIPT_BASE}/adresses_qc.csv
dataprep:
  pdf_ocr: off
  citation_minimum: page
outputs:
  state_dir: .graphify
  write_html: false
EOF_YML

# ── 3. Transform baseline → extraction v2.3 ───────────────────────────────────
if ! node "$GRAPHIFY_TO_EXTRACTION" "$WORK_DIR/latest.old.json" "$CITY" "$baseline_extraction" >> "$LOG" 2>&1; then
  echo "[worker] $CITY: extraction_transform_failed" >&2
  exit 1
fi

# ── 4. Download and verify the exact CAS corpus ───────────────────────────────
if [ -n "$SOURCE_ID" ]; then
  city_manifest="$WORK_DIR/cas-manifest.tsv"
  docs_verified=$(bash "$DOWNLOAD_CAS" "$CITY" "$CAS_MANIFEST" "$WORK_DIR")
  docs_expected=$(awk 'END {print NR-1}' "$city_manifest")
fi

# ── 5. Build profile and deterministic dataprep ───────────────────────────────
if ! "$GRAPHIFY_CLI" profile build "$WORK_DIR" --config "$local_graphify_yaml" --out-dir ".graphify" --all >> "$LOG" 2>&1; then
  echo "[worker] $CITY: build_failed" >&2
  exit 1
fi

# ── 6. Semantic extraction of each immutable CAS document ────────────────────
if [ -n "$SOURCE_ID" ]; then
  batch_sha=$(sha256sum "$CAS_MANIFEST" | awk '{print $1}')
  calls_at_start=$(cat "$LLM_COUNTER")
  bash "$EXTRACT_CAS" "$CITY" "$city_manifest" "$WORK_DIR" "$LLM_COUNTER" \
    "$FINDINGS_SCHEMA" "$EXTRACTION_PROMPT"
  calls_at_end=$(cat "$LLM_COUNTER")
  node "$FINDINGS_TO_EXTRACTION" "$CITY" "$CAS_MANIFEST" "$WORK_DIR/corpus" \
    "$WORK_DIR/findings" "$batch_sha" "$fresh_extraction" >> "$LOG" 2>&1
  node "$MERGE_EXTRACTIONS" "$baseline_extraction" "$fresh_extraction" "$local_extraction" >> "$LOG" 2>&1
else
  cp "$baseline_extraction" "$local_extraction"
fi

# ── 7. Validate the merged extraction ─────────────────────────────────────────
# Note: validate-extraction retourne exit 1 si valid=false ; on capture quand même le JSON
"$GRAPHIFY_CLI" profile validate-extraction \
    --profile-state "$WORK_DIR/.graphify/profile/profile-state.json" \
    --input "$local_extraction" \
    --json > "$local_validation" 2>>"$LOG" || true

if [ ! -s "$local_validation" ]; then
  echo "[worker] $CITY: validate_command_failed" >&2
  exit 1
fi

if ! jq -r '.valid' "$local_validation" 2>/dev/null | grep -q true; then
  echo "[worker] $CITY: validation_invalid" >&2
  exit 1
fi

if jq -e '.issues[] | select(.severity=="error")' "$local_validation" >/dev/null 2>&1; then
  echo "[worker] $CITY: validation_schema_error" >&2
  exit 1
fi

# ── 8. Ontology output ────────────────────────────────────────────────────────
if ! "$GRAPHIFY_CLI" profile ontology-output \
    --profile-state "$WORK_DIR/.graphify/profile/profile-state.json" \
    --input "$local_extraction" \
    --out-dir "$WORK_DIR/.graphify/ontology" >> "$LOG" 2>&1; then
  echo "[worker] $CITY: ontology_output_failed" >&2
  exit 1
fi

# ── 9. Finalisation graph v2.3 ────────────────────────────────────────────────
candidate_pv_count=$((pv_count + docs_verified))
if ! node "$EXTRACTION_TO_GRAPH" "$local_extraction" "$CITY" "$candidate_pv_count" "$latest_candidate_raw" >> "$LOG" 2>&1; then
  echo "[worker] $CITY: finalize_failed" >&2
  exit 1
fi

# ── 10. Nettoyage des refs générées ──────────────────────────────────────────
cat > "$clean_script" << 'EOF_CLEAN'
import fs from 'node:fs';
const [input, out] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(input, 'utf8'));
const hasGroundedRef = (r) => {
  const rawRef = String(r.rawRef || '').trim();
  if (rawRef && /^generated:\/\//i.test(rawRef)) return false;
  return Boolean(
    (r.docSha || '').toString().trim() ||
    (r.sourceUrl || '').toString().trim() ||
    (r.pdfPath || '').toString().trim() ||
    rawRef
  );
};
for (const e of g.edges || []) {
  e.refs = Array.isArray(e.refs) ? e.refs.filter(hasGroundedRef) : [];
}
for (const n of g.nodes || []) {
  if (!n.properties || typeof n.properties !== 'object') n.properties = {};
  const p = n.properties;
  const hasSourceLink = Boolean(
    (p.docSha || '').toString().trim() ||
    (p.sourceUrl || '').toString().trim() ||
    (p.pdfPath || '').toString().trim() ||
    (p.rawRef || '').toString().trim()
  );
  if ((n.type === 'Signal' || n.type === 'DesignationEvent') && !hasSourceLink) {
    p.evidence_quality = 'missing_source_link';
  }
}
fs.writeFileSync(out, JSON.stringify(g, null, 2));
EOF_CLEAN

if ! node "$clean_script" "$latest_candidate_raw" "$latest_candidate" >> "$LOG" 2>&1; then
  echo "[worker] $CITY: clean_refs_failed" >&2
  exit 1
fi

fresh_signals=$(jq --arg batch "${batch_sha:-}" '[.nodes[] | select(.type=="Signal" and .properties.ingestion_manifest_sha==$batch)] | length' "$latest_candidate")
fresh_events=$(jq --arg batch "${batch_sha:-}" '[.nodes[] | select(.type=="DesignationEvent" and .properties.ingestion_manifest_sha==$batch)] | length' "$latest_candidate")
jq -n --argjson expected "$docs_expected" --argjson verified "$docs_verified" \
  --argjson extractionCalls "$((calls_at_end - calls_at_start))" \
  --argjson freshSignals "$fresh_signals" --argjson freshEvents "$fresh_events" \
  '{documentsExpected:$expected,documentsVerified:$verified,extractionCalls:$extractionCalls,descriptionCalls:0,freshSignals:$freshSignals,freshEvents:$freshEvents}' \
  > "$WORK_DIR/cas-metrics.json"

echo "[worker] $CITY: candidat produit → $latest_candidate"
exit 0
