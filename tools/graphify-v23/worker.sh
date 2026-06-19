#!/usr/bin/env bash
# worker.sh — worker v2.3 : extraction candidate uniquement (PAS de publish)
# Usage: worker.sh <city> <baseline_json> <work_dir> <root_dir>
# Produit: <work_dir>/latest.v23.json (candidat) ou exit 1
set -euo pipefail

CITY="${1:?city requis}"
BASELINE="${2:?baseline_json requis}"
WORK_DIR="${3:?work_dir requis}"
ROOT="${4:?root_dir requis}"

GRAPHIFY_CLI="$ROOT/node_modules/.bin/graphify"
SCRIPT_BASE="$ROOT/tmp/graphify-v23-cli-20260618-1155/worker/agent-04/test-aguanish/references"
ONTOLOGY_PROFILE="$ROOT/radar/ontology/ontology-profile.yaml"

GRAPHIFY_TO_EXTRACTION="$ROOT/tools/graphify-v23/graphify_to_extraction_v23.js"
EXTRACTION_TO_GRAPH="$ROOT/tools/graphify-v23/extraction_to_v23_graph.js"

# Fallback: utiliser les versions dans /tmp si absentes du repo
if [ ! -f "$GRAPHIFY_TO_EXTRACTION" ]; then
  GRAPHIFY_TO_EXTRACTION="/tmp/graphify_to_extraction_v23.js"
fi
if [ ! -f "$EXTRACTION_TO_GRAPH" ]; then
  EXTRACTION_TO_GRAPH="/tmp/extraction_to_v23_graph.js"
fi

mkdir -p "$WORK_DIR/raw/proces-verbaux-$CITY" "$WORK_DIR/raw/$CITY" "$WORK_DIR/parsed/$CITY"

local_extraction="$WORK_DIR/extraction.v23.json"
local_validation="$WORK_DIR/validation.json"
local_graphify_yaml="$WORK_DIR/graphify.yaml"
latest_candidate_raw="$WORK_DIR/latest.generated.v23.json"
latest_candidate="$WORK_DIR/latest.v23.json"
clean_script="$WORK_DIR/clean-generated-refs.mjs"
LOG="$WORK_DIR/worker.log"

# ── 1. Vérifier le baseline ───────────────────────────────────────────────────
if [ ! -f "$BASELINE" ]; then
  echo "[worker] $CITY: baseline manquant ($BASELINE)" >&2
  exit 1
fi

cp "$BASELINE" "$WORK_DIR/latest.old.json"

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
    - "${WORK_DIR}/raw/proces-verbaux-${CITY}"
    - "${WORK_DIR}/raw/${CITY}"
    - "${WORK_DIR}/parsed/${CITY}"
  registries:
    - ${SCRIPT_BASE}/municipalities.csv
    - ${SCRIPT_BASE}/cadastre.csv
    - ${SCRIPT_BASE}/adresses_qc.csv
dataprep:
  pdf_ocr: auto
  citation_minimum: page
outputs:
  state_dir: .graphify
  write_html: false
EOF_YML

# ── 3. Transform baseline → extraction v2.3 ───────────────────────────────────
if ! node "$GRAPHIFY_TO_EXTRACTION" "$WORK_DIR/latest.old.json" "$CITY" "$local_extraction" >> "$LOG" 2>&1; then
  echo "[worker] $CITY: extraction_transform_failed" >&2
  exit 1
fi

# ── 4. Build profile (non-LLM) ────────────────────────────────────────────────
if ! "$GRAPHIFY_CLI" profile build "$WORK_DIR" --config "$local_graphify_yaml" --out-dir "$WORK_DIR/.graphify" --all >> "$LOG" 2>&1; then
  echo "[worker] $CITY: build_failed" >&2
  exit 1
fi

# ── 5. Validate extraction ────────────────────────────────────────────────────
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

# ── 6. Ontology output ────────────────────────────────────────────────────────
if ! "$GRAPHIFY_CLI" profile ontology-output \
    --profile-state "$WORK_DIR/.graphify/profile/profile-state.json" \
    --input "$local_extraction" \
    --out-dir "$WORK_DIR/.graphify/ontology" >> "$LOG" 2>&1; then
  echo "[worker] $CITY: ontology_output_failed" >&2
  exit 1
fi

# ── 7. Finalisation graph v2.3 ────────────────────────────────────────────────
if ! node "$EXTRACTION_TO_GRAPH" "$local_extraction" "$CITY" "$pv_count" "$latest_candidate_raw" >> "$LOG" 2>&1; then
  echo "[worker] $CITY: finalize_failed" >&2
  exit 1
fi

# ── 8. Nettoyage des refs générées ───────────────────────────────────────────
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

echo "[worker] $CITY: candidat produit → $latest_candidate"
exit 0
