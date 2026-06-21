#!/usr/bin/env bash
# worker-grounding.sh — Grounding verbatim d'un candidat v2.3 (missing_source_link)
#
# Usage: worker-grounding.sh <city> <candidate_json> <out_json> <work_dir> <root_dir>
#
# Pipeline:
#   1. Mapper chaque Signal/DesignationEvent → docSha (direct ou via arête raises_signal)
#   2. Télécharger les PDFs depuis S3 (raw/proces-verbaux-<city>/cas/<docSha>.pdf)
#   3. pdftotext -layout + marquage page ===== PAGE N =====
#   4. claude -p Sonnet 4.6 → page + citation verbatim par nœud (anti-hallucination)
#   5. Télécharger les .meta.json sidecars (sourceUrl/rawRef)
#   6. Injecter grounding dans le graphe (build-grounded-graph.py)
#   7. Sortie: out_json prêt pour gate.sh
#
# Requis: jq, python3, pdftotext, claude CLI, s5cmd
# Env: SCRAPE_S3_BUCKET, SCRAPE_S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# Exit 0 si OK (même si grounding partiel), 1 si erreur bloquante

set -euo pipefail

CITY="${1:?city requis}"
CANDIDATE="${2:?candidate_json requis}"
OUT_JSON="${3:?out_json requis}"
WORK_DIR="${4:?work_dir requis}"
ROOT="${5:?root_dir requis}"

CLAUDE_MODEL="claude-sonnet-4-6"
BUCKET="${SCRAPE_S3_BUCKET:-}"
S3_URL="${SCRAPE_S3_ENDPOINT:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[grounding/$CITY] $*"; }
err() { echo "[grounding/$CITY] ERREUR: $*" >&2; }

# ── Vérifications préliminaires ───────────────────────────────────────────────
if [ ! -f "$CANDIDATE" ]; then
  err "candidat introuvable: $CANDIDATE"; exit 1
fi
if [ -z "$BUCKET" ] || [ -z "$S3_URL" ]; then
  err "credentials SCW manquants (SCRAPE_S3_BUCKET/SCRAPE_S3_ENDPOINT)"; exit 1
fi
if ! command -v pdftotext >/dev/null 2>&1; then
  err "pdftotext manquant (apt install poppler-utils)"; exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  err "claude CLI manquant"; exit 1
fi

mkdir -p "$WORK_DIR/pdfs" "$WORK_DIR/txts" "$WORK_DIR/cites" "$WORK_DIR/meta"

# ── 1. Mapper signaux → docSha via arêtes raises_signal ──────────────────────
log "Étape 1: mapper Signal/DesignationEvent → docSha"

NODES_MAP_FILE="$WORK_DIR/nodes-by-sha.json"

python3 - "$CANDIDATE" "$NODES_MAP_FILE" <<'PYMAP'
import json, sys
candidate_path = sys.argv[1]
out_path = sys.argv[2]
g = json.load(open(candidate_path))
nodes = {n["id"]: n for n in g["nodes"]}

node_sha = {}
node_page = {}

# 1) Direct docSha on node properties
for n in g["nodes"]:
    if n.get("type") in ("DesignationEvent", "Signal"):
        ds = (n.get("properties") or {}).get("docSha")
        if ds:
            node_sha[n["id"]] = ds

# 2) Via raises_signal edges (edge target=signal, source=event)
for e in g.get("edges", []):
    refs = [r for r in (e.get("refs") or []) if isinstance(r, dict)]
    ds = next((r.get("docSha") for r in refs if r.get("docSha")), None)
    page = next((r.get("page") for r in refs if r.get("page")), None)
    if not ds:
        src = nodes.get(e.get("source"))
        if src:
            ds = (src.get("properties") or {}).get("docSha")
    if ds:
        for ep in (e.get("source"), e.get("target")):
            nn = nodes.get(ep)
            if nn and nn.get("type") in ("DesignationEvent", "Signal"):
                if ep not in node_sha:
                    node_sha[ep] = ds
                if page and ep not in node_page:
                    node_page[ep] = page

# Grouper par docSha
by_sha = {}
for node_id, ds in node_sha.items():
    nn = nodes.get(node_id)
    if not nn:
        continue
    if ds not in by_sha:
        by_sha[ds] = {"docSha": ds, "nodes": []}
    entry = {
        "id": node_id,
        "type": nn.get("type"),
        "label": nn.get("label") or nn.get("id") or "",
        "properties": {k: v for k, v in (nn.get("properties") or {}).items()
                       if k in ("description", "category", "kind", "date", "municipality", "etape", "outcome")},
    }
    if node_id in node_page:
        entry["hint_page"] = node_page[node_id]
    by_sha[ds]["nodes"].append(entry)

result = list(by_sha.values())
json.dump(result, open(out_path, "w"), ensure_ascii=False, indent=2)
missing = [n["id"] for n in g["nodes"]
           if n.get("type") in ("DesignationEvent","Signal")
           and n["id"] not in node_sha]
print(f"docShas: {len(result)}, noeuds mappes: {sum(len(e['nodes']) for e in result)}, non-mappes: {len(missing)}")
PYMAP

total_shas=$(jq 'length' "$NODES_MAP_FILE" 2>/dev/null || echo 0)
log "  $total_shas docShas distincts"

if [ "$total_shas" -eq 0 ]; then
  err "Aucun docSha trouvé — aucun grounding possible"
  exit 1
fi

# ── 2. Télécharger PDFs et .meta.json depuis S3 ──────────────────────────────
log "Étape 2: téléchargement PDFs + métas depuis S3"

download_doc() {
  local sha="$1"
  local dest_pdf="$WORK_DIR/pdfs/${sha}.pdf"
  local dest_meta="$WORK_DIR/meta/${sha}.meta.json"

  if [ -s "$dest_pdf" ]; then
    log "  [skip-dl] $sha"
    # Essayer quand même de télécharger le meta si manquant
    if [ ! -s "$dest_meta" ]; then
      s5cmd --endpoint-url "$S3_URL" cp \
        "s3://$BUCKET/raw/proces-verbaux-${CITY}/cas/${sha}.pdf.meta.json" \
        "$dest_meta" >/dev/null 2>&1 || true
    fi
    return 0
  fi

  # Pattern principal: raw/proces-verbaux-<city>/cas/<sha>.pdf
  local key="raw/proces-verbaux-${CITY}/cas/${sha}.pdf"
  if s5cmd --endpoint-url "$S3_URL" cp "s3://$BUCKET/$key" "$dest_pdf" >/dev/null 2>&1; then
    log "  [ok-dl] $sha (proces-verbaux-$CITY/cas)"
    s5cmd --endpoint-url "$S3_URL" cp "s3://$BUCKET/${key}.meta.json" "$dest_meta" >/dev/null 2>&1 || true
    return 0
  fi

  # Fallback HTML
  local dest_html="$WORK_DIR/pdfs/${sha}.html"
  local html_key="raw/proces-verbaux-${CITY}/cas/${sha}.html"
  if s5cmd --endpoint-url "$S3_URL" cp "s3://$BUCKET/$html_key" "$dest_html" >/dev/null 2>&1; then
    log "  [ok-dl-html] $sha"
    s5cmd --endpoint-url "$S3_URL" cp "s3://$BUCKET/${html_key}.meta.json" "$dest_meta" >/dev/null 2>&1 || true
    return 0
  fi

  log "  [WARN-dl] $sha: document introuvable (raw/proces-verbaux-$CITY/cas/)"
  return 1
}

while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  download_doc "$sha" || true
done < <(jq -r '.[].docSha' "$NODES_MAP_FILE" 2>/dev/null)

# ── 3. pdftotext + marquage page ─────────────────────────────────────────────
log "Étape 3: pdftotext + marquage pages"

for pdf in "$WORK_DIR/pdfs/"*.pdf; do
  [ -f "$pdf" ] || continue
  sha=$(basename "$pdf" .pdf)
  out_txt="$WORK_DIR/txts/${sha}.txt"
  if [ -s "$out_txt" ]; then continue; fi
  raw_txt="$WORK_DIR/txts/${sha}.raw.txt"
  if pdftotext -layout "$pdf" "$raw_txt" 2>/dev/null; then
    python3 - "$raw_txt" "$out_txt" <<'PYPAGE'
import sys
raw = open(sys.argv[1], errors='replace').read()
pages = raw.split('\x0c')
out = []
for i, page in enumerate(pages):
    if page.strip():
        out.append(f'===== PAGE {i+1} =====')
        out.append(page)
open(sys.argv[2], 'w').write('\n'.join(out))
PYPAGE
    log "  [ok-pdf] $sha: texte extrait"
  else
    log "  [WARN-pdf] $sha: pdftotext échoué"
  fi
done

# Convertir HTML en texte si présent
for html in "$WORK_DIR/pdfs/"*.html; do
  [ -f "$html" ] || continue
  sha=$(basename "$html" .html)
  out_txt="$WORK_DIR/txts/${sha}.txt"
  if [ ! -s "$out_txt" ]; then
    python3 -c "
import sys
from html.parser import HTMLParser
class S(HTMLParser):
    def __init__(self): super().__init__(); self.t=[]
    def handle_data(self,d): self.t.append(d)
s=S(); s.feed(open('$html',errors='replace').read())
open('$out_txt','w').write('===== PAGE 1 =====\n'+' '.join(s.t))
" 2>/dev/null && log "  [ok-html] $sha" || log "  [WARN-html] $sha: conversion échouée"
  fi
done

# ── 4. Extraction citations LLM (Sonnet 4.6) ─────────────────────────────────
log "Étape 4: extraction citations verbatim (Sonnet 4.6)"

while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  cite_out="$WORK_DIR/cites/${sha}.json"
  if [ -s "$cite_out" ]; then
    log "  [skip-llm] $sha"
    continue
  fi

  pvtext="$WORK_DIR/txts/${sha}.txt"
  if [ ! -s "$pvtext" ]; then
    log "  [WARN-llm] $sha: texte introuvable → émis vide"
    echo '{"results":[]}' > "$cite_out"
    continue
  fi

  nodes_json=$(jq -c --arg s "$sha" '.[]|select(.docSha==$s)|.nodes' "$NODES_MAP_FILE" 2>/dev/null || echo "[]")
  n_nodes=$(echo "$nodes_json" | jq 'length' 2>/dev/null || echo 0)
  log "  [llm] $sha: $n_nodes nœuds"

  prompt_file="$WORK_DIR/cites/${sha}.prompt.txt"
  {
    printf "Tu es un extracteur de citations pour un procès-verbal municipal (Municipalité de %s, Québec).\n" "$CITY"
    echo "On te donne le TEXTE INTÉGRAL d'un PV avec des marqueurs '===== PAGE N =====' découpés par page."
    echo ""
    echo "Pour CHAQUE nœud listé, trouve dans le PV le passage EXACT (verbatim) qui le justifie, et sa page."
    echo ""
    echo "RÈGLES STRICTES:"
    echo "- excerpt = copie VERBATIM d'une ou deux phrases du PV (titre de résolution + extrait du dispositif). 30 à 400 caractères. AUCUNE reformulation, AUCUNE invention."
    echo "- page = le numéro de la PAGE (marqueur ===== PAGE N =====) où commence le passage."
    echo "- Si tu ne TROUVES PAS le passage pour un nœud dans ce PV: \"found\": false, page: 0, excerpt: \"\"."
    echo "- Réponds UNIQUEMENT par un objet JSON valide, rien d'autre. Format exact:"
    printf '  {"results":[{"id":"<id>","found":true,"page":<int>,"excerpt":"<verbatim>"}]}\n'
    echo ""
    echo "NŒUDS À GROUNDER:"
    echo "$nodes_json"
    echo ""
    echo "===== DÉBUT DU PV ====="
    cat "$pvtext"
    echo "===== FIN DU PV ====="
  } > "$prompt_file"

  raw_resp="$WORK_DIR/cites/${sha}.raw.txt"
  # Retry jusqu'à 3 fois si réponse vide / pas de JSON (box chargée → claude lent).
  llm_ok=0
  for attempt in 1 2 3; do
    if timeout 360 claude -p --model "$CLAUDE_MODEL" < "$prompt_file" > "$raw_resp" 2>"$WORK_DIR/cites/${sha}.err.txt"; then
      if grep -q '{' "$raw_resp" 2>/dev/null && [ -s "$raw_resp" ]; then
        llm_ok=1; break
      fi
      log "  [retry-llm] $sha: tentative $attempt réponse vide/sans JSON"
    else
      log "  [retry-llm] $sha: tentative $attempt timeout/erreur"
    fi
  done
  if [ "$llm_ok" = "1" ]; then
    python3 - "$sha" "$WORK_DIR" <<'PYPARS'
import sys, json, re, pathlib
sha = sys.argv[1]; work = sys.argv[2]
raw = pathlib.Path(f"{work}/cites/{sha}.raw.txt").read_text(encoding="utf-8", errors="replace")
m = re.search(r"\{.*\}", raw, re.S)
if not m:
    pathlib.Path(f"{work}/cites/{sha}.json").write_text('{"results":[]}')
    print(f"[WARN-parse] {sha}: pas de JSON dans réponse")
    sys.exit(0)
try:
    obj = json.loads(m.group(0))
except Exception as e:
    pathlib.Path(f"{work}/cites/{sha}.json").write_text('{"results":[]}')
    print(f"[WARN-parse] {sha}: JSON invalide: {e}")
    sys.exit(0)
pathlib.Path(f"{work}/cites/{sha}.json").write_text(
    json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
n = len(obj.get("results", [])); found = sum(1 for r in obj.get("results",[]) if r.get("found"))
print(f"[cites] {sha}: {found}/{n} trouvés")
PYPARS
  else
    log "  [WARN-llm] $sha: claude timeout/erreur"
    echo '{"results":[]}' > "$cite_out"
  fi

done < <(jq -r '.[].docSha' "$NODES_MAP_FILE" 2>/dev/null)

# ── 5. Injection grounding ────────────────────────────────────────────────────
log "Étape 5: injection grounding (build-grounded-graph.py)"

INJECT_SCRIPT="$SCRIPT_DIR/build-grounded-graph.py"
if [ ! -f "$INJECT_SCRIPT" ]; then
  INJECT_SCRIPT="$ROOT/tools/grounding/build-grounded-graph.py"
fi
if [ ! -f "$INJECT_SCRIPT" ]; then
  err "build-grounded-graph.py introuvable dans $SCRIPT_DIR ni $ROOT/tools/grounding/"
  exit 1
fi

python3 "$INJECT_SCRIPT" "$CANDIDATE" "$OUT_JSON" "$WORK_DIR/meta" "$WORK_DIR/cites"

# ── 6. Vérification ──────────────────────────────────────────────────────────
remaining=$(jq '[.nodes[] | select(
  (.type=="Signal" or .type=="DesignationEvent") and
  (.properties.evidence_quality=="missing_source_link")
)] | length' "$OUT_JSON" 2>/dev/null || echo 999)

gen_refs=$(jq '[.edges[].refs[]? | select(
  (.rawRef//"") | tostring | startswith("generated://")
)] | length' "$OUT_JSON" 2>/dev/null || echo 999)

grounded=$(jq '[.nodes[] | select(
  (.type=="Signal" or .type=="DesignationEvent") and
  ((.properties.docSha//"") | length > 0)
)] | length' "$OUT_JSON" 2>/dev/null || echo 0)

log "RÉSULTAT: grounded=$grounded, missing_source_link=$remaining, gen_refs=$gen_refs"
log "DONE: $OUT_JSON"
exit 0
