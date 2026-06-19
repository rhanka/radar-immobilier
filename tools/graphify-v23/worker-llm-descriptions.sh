#!/usr/bin/env bash
# worker-llm-descriptions.sh — enrichissement LLM des descriptions manquantes (Sonnet 4.6)
# Usage: worker-llm-descriptions.sh <candidate_json> <out_json> [--dry-run]
#
# Lit un candidat v2.3, trouve tous les nœuds Signal/DesignationEvent sans description,
# génère une description via `claude -p --model claude-sonnet-4-6`, injecte, écrit le résultat.
#
# Requis: claude CLI dans PATH (claude --version >= 2.1), jq >= 1.6
# Sortie : <out_json> avec descriptions injectées ; exit 0 si OK, exit 1 si erreur bloquante.
set -euo pipefail

CANDIDATE="${1:?candidate_json requis}"
OUT_JSON="${2:?out_json requis}"
DRY_RUN_FLAG="${3:-}"

CLAUDE_MODEL="claude-sonnet-4-6"
CLAUDE_CLI="claude"
MAX_RETRIES=2

# ── Checks préliminaires ─────────────────────────────────────────────────────
if ! command -v "$CLAUDE_CLI" >/dev/null 2>&1; then
  echo "[worker-llm] ERREUR: claude CLI introuvable dans PATH" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[worker-llm] ERREUR: jq introuvable dans PATH" >&2
  exit 1
fi

if [ ! -f "$CANDIDATE" ]; then
  echo "[worker-llm] ERREUR: candidat introuvable: $CANDIDATE" >&2
  exit 1
fi

CITY=$(jq -r '.municipality // "unknown"' "$CANDIDATE" 2>/dev/null || echo "unknown")
echo "[worker-llm] $CITY: démarrage enrichissement descriptions LLM (modèle: $CLAUDE_MODEL)"

# ── Compter les nœuds sans description ───────────────────────────────────────
missing_count=$(jq '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.description//"") | length == 0))] | length' "$CANDIDATE" 2>/dev/null || echo 0)
echo "[worker-llm] $CITY: $missing_count nœuds sans description"

if [ "$missing_count" -eq 0 ]; then
  cp "$CANDIDATE" "$OUT_JSON"
  echo "[worker-llm] $CITY: aucune description à générer → copie directe"
  exit 0
fi

if [ "$DRY_RUN_FLAG" = "--dry-run" ]; then
  echo "[worker-llm] $CITY: DRY-RUN — génération LLM skippée, $missing_count descriptions manquantes"
  cp "$CANDIDATE" "$OUT_JSON"
  exit 0
fi

# ── Travailler sur une copie temporaire ──────────────────────────────────────
TMP_JSON="${OUT_JSON}.tmp.$$"
cp "$CANDIDATE" "$TMP_JSON"
trap 'rm -f "$TMP_JSON"' EXIT

# ── Générer les descriptions une par une ─────────────────────────────────────
total_generated=0
total_failed=0
start_time=$(date +%s)

# Extraire la liste des IDs de nœuds sans description
node_ids=$(jq -r '.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.description//"") | length == 0)) | .id' "$TMP_JSON" 2>/dev/null)

while IFS= read -r node_id; do
  [ -z "$node_id" ] && continue

  # Extraire les infos du nœud
  node_json=$(jq --arg id "$node_id" '.nodes[] | select(.id == $id)' "$TMP_JSON" 2>/dev/null)
  node_type=$(echo "$node_json" | jq -r '.type')
  node_label=$(echo "$node_json" | jq -r '.label')
  node_props=$(echo "$node_json" | jq -c '.properties')

  # Construire le prompt
  PROMPT="Tu es un assistant spécialisé en urbanisme et immobilier québécois.
Génère une description factuelle et concise (1-2 phrases max, 20-60 mots) pour ce nœud de type $node_type appartenant à la municipalité $CITY.

Nœud:
- label: $node_label
- propriétés: $node_props

Règles:
- La description doit synthétiser ce que représente ce signal ou événement immobilier
- Utiliser le contexte du label pour inférer le contenu (règlement, zonage, dérogation, etc.)
- Langue française, ton factuel et neutre
- Si le label contient des termes techniques de zonage québécois (PIIA, PPCMOI, CPTAQ, etc.), les conserver
- NE PAS inventer de détails absents du label ou des propriétés
- Répondre UNIQUEMENT avec la description, sans préfixe ni explication"

  # Appeler claude CLI avec retries
  description=""
  retry=0
  while [ $retry -le $MAX_RETRIES ]; do
    raw_desc=$(echo "$PROMPT" | timeout 45 "$CLAUDE_CLI" -p --model "$CLAUDE_MODEL" 2>/dev/null | tr -d '\n' | xargs 2>/dev/null || echo "")
    # Vérifier que la réponse est non vide et raisonnable (entre 10 et 500 chars)
    desc_len=${#raw_desc}
    if [ "$desc_len" -ge 10 ] && [ "$desc_len" -le 500 ]; then
      description="$raw_desc"
      break
    fi
    retry=$((retry + 1))
    if [ $retry -le $MAX_RETRIES ]; then
      echo "[worker-llm] $CITY: $node_id retry $retry (got: '${raw_desc:0:50}'...)"
    fi
  done

  if [ -z "$description" ]; then
    # Fallback: utiliser le label comme description
    description="$node_label"
    echo "[worker-llm] $CITY: $node_id FALLBACK→label (échec LLM après $MAX_RETRIES retries)"
    total_failed=$((total_failed + 1))
  else
    total_generated=$((total_generated + 1))
  fi

  # Injecter la description dans le JSON temporaire
  updated=$(jq \
    --arg id "$node_id" \
    --arg desc "$description" \
    '(.nodes[] | select(.id == $id) | .properties.description) |= $desc' \
    "$TMP_JSON" 2>/dev/null)

  if [ -z "$updated" ]; then
    echo "[worker-llm] $CITY: $node_id ERREUR injection jq" >&2
    total_failed=$((total_failed + 1))
    continue
  fi

  echo "$updated" > "$TMP_JSON"
  echo "[worker-llm] $CITY: $node_id OK — '${description:0:60}...'"

done <<< "$node_ids"

# ── Vérification finale ───────────────────────────────────────────────────────
remaining=$(jq '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and ((.properties.description//"") | length == 0))] | length' "$TMP_JSON" 2>/dev/null || echo 999)
end_time=$(date +%s)
elapsed=$((end_time - start_time))

echo "[worker-llm] $CITY: terminé — généré=$total_generated, fallback=$total_failed, restants=$remaining, temps=${elapsed}s"

# Copier vers la destination finale
cp "$TMP_JSON" "$OUT_JSON"

if [ "$remaining" -gt 0 ]; then
  echo "[worker-llm] $CITY: AVERTISSEMENT — $remaining descriptions encore vides après enrichissement" >&2
  exit 1
fi

exit 0
