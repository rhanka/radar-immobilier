#!/usr/bin/env bash
# Pour chaque docSha, demande à Sonnet 4.6 la page + citation verbatim de chaque noeud.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p cites

SHAS=$(jq -r '.[].docSha' nodes-by-sha.json)

for sha in $SHAS; do
  out="cites/$sha.json"
  if [ -s "$out" ]; then echo "[skip] $sha déjà fait"; continue; fi
  pvtext="txtp/$sha.txt"
  nodes=$(jq -c --arg s "$sha" '.[]|select(.docSha==$s)|.nodes' nodes-by-sha.json)

  prompt_file="cites/$sha.prompt.txt"
  {
    echo "Tu es un extracteur de citations pour un procès-verbal municipal (Ville de Rimouski, Québec)."
    echo "On te donne le TEXTE INTÉGRAL d'un PV avec des marqueurs '===== PAGE N ====='."
    echo "Pour CHAQUE noeud listé ci-dessous, trouve dans le PV le passage EXACT (verbatim) qui justifie ce noeud, et sa page."
    echo ""
    echo "RÈGLES STRICTES:"
    echo "- excerpt = copie VERBATIM d'une ou deux phrases du PV (titre de résolution + extrait du dispositif). 30 à 400 caractères. AUCUNE reformulation, AUCUNE invention."
    echo "- page = le numéro de la PAGE (marqueur ===== PAGE N =====) où commence le passage."
    echo "- Si tu ne TROUVES PAS le passage justifiant un noeud dans ce PV, mets \"found\": false, page: 0, excerpt: \"\"."
    echo "- Réponds UNIQUEMENT par un objet JSON, rien d'autre. Format:"
    echo '  {"results":[{"id":"<node id>","found":true,"page":<int>,"excerpt":"<verbatim>"}]}'
    echo ""
    echo "NOEUDS À GROUNDER (JSON):"
    echo "$nodes"
    echo ""
    echo "===== DÉBUT DU PV ====="
    cat "$pvtext"
    echo "===== FIN DU PV ====="
  } > "$prompt_file"

  echo "[run] $sha ($(wc -c < "$prompt_file") octets de prompt)"
  # Sonnet 4.6, sortie texte; on extrait le JSON ensuite
  claude -p --model claude-sonnet-4-6 < "$prompt_file" > "cites/$sha.raw.txt" 2>"cites/$sha.err.txt" || {
    echo "[ERR] claude a échoué pour $sha (voir cites/$sha.err.txt)"; continue;
  }
  # Extraire le bloc JSON {...}
  python3 - "$sha" <<'PY'
import sys, json, re, pathlib
sha = sys.argv[1]
raw = pathlib.Path(f"cites/{sha}.raw.txt").read_text(encoding="utf-8", errors="replace")
m = re.search(r"\{.*\}", raw, re.S)
if not m:
    print(f"[ERR] pas de JSON pour {sha}")
    sys.exit(0)
try:
    obj = json.loads(m.group(0))
except Exception as e:
    print(f"[ERR] JSON invalide {sha}: {e}")
    sys.exit(0)
pathlib.Path(f"cites/{sha}.json").write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
n = len(obj.get("results", []))
found = sum(1 for r in obj.get("results", []) if r.get("found"))
print(f"[ok] {sha}: {found}/{n} cités")
PY
done
echo "=== DONE ==="
