#!/usr/bin/env bash
# snap-ref.sh — snapshot d'appartenance B′ de la classification AU REF <ref>.
#
# Checkout le sous-système de classification au ref donné, rejoue le harnais
# de snapshot sur le corpus prod figé, puis RESTAURE HEAD (garanti par trap).
# Ne compile QUE le graphe de dépendances de `classifyVivierSignal` ; le reste
# du worktree n'est pas touché.
#
# Usage :
#   RECETTE_PG_NDJSON=<dump.ndjson> RECETTE_SNAP_DIR=<out-dir> \
#     scripts/recette/snap-ref.sh <ref>
#
# Prérequis : node_modules installés (npm ci), dump prod PG extrait (cf.
# docs/reports/recette/RECETTE_HARNESS_REJEU_PROD.md §1).
set -uo pipefail

REF="${1:?usage: snap-ref.sh <ref>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NDJSON="${RECETTE_PG_NDJSON:?RECETTE_PG_NDJSON manquant (dump prod PG)}"
SNAP_DIR="${RECETTE_SNAP_DIR:?RECETTE_SNAP_DIR manquant (dossier de sortie)}"
mkdir -p "$SNAP_DIR"

# Fichiers de classification à figer au ref (sous-graphe de classifyVivierSignal).
FILES=(api/src/services/graph/vivier-v2.ts packages/radar-domain/src)

# Restauration bulletproof (dé-stage index + worktree à HEAD), indépendante du
# CWD au moment du trap — git -C "$REPO" ancre les pathspecs à la racine du repo.
restore() {
  git -C "$REPO" reset -q HEAD -- "${FILES[@]}" 2>/dev/null || true
  git -C "$REPO" checkout -- "${FILES[@]}" 2>/dev/null || true
}
trap restore EXIT
git -C "$REPO" checkout "$REF" -- "${FILES[@]}"

cd "$REPO/api"
RECETTE_PG_NDJSON="$NDJSON" RECETTE_SNAPSHOT_OUT="$SNAP_DIR/$REF.ndjson" \
  npx vitest run src/services/graph/recette-membership-snapshot.prod.test.ts 2>&1 \
  | grep -E 'RECETTE_SNAPSHOT_TALLY|failed|Error' | head -5
