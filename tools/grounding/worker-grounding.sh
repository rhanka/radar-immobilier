#!/usr/bin/env bash
# worker-grounding.sh — Grounding verbatim d'un candidat v2.3 (missing_source_link)
#
# Usage: worker-grounding.sh <city> <candidate_json> <out_json> <work_dir> <root_dir>
#
# Pipeline:
#   1. Mapper chaque Signal/DesignationEvent → docSha (direct ou via arête raises_signal)
#   2. Télécharger les PDFs depuis S3 (raw/proces-verbaux-<city>/cas/<docSha>.pdf)
#   3. pdftotext -layout + marquage page ===== PAGE N =====
#   4. codex CLI → mesh → gpt-5.6-luna → page + citation verbatim par nœud (fail-closed, anti-hallucination)
#   5. Télécharger les .meta.json sidecars (sourceUrl/rawRef)
#   6. Injecter grounding dans le graphe (build-grounded-graph.py)
#   7. Sortie: out_json prêt pour gate.sh
#
# Requis: jq, python3, pdftotext, codex CLI (STAGE2 host, mesh+luna), s5cmd
# Env: SCRAPE_S3_BUCKET, SCRAPE_S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# Exit 0 si OK (même si grounding partiel), 1 si erreur bloquante

set -euo pipefail

CITY="${1:?city requis}"
CANDIDATE="${2:?candidate_json requis}"
OUT_JSON="${3:?out_json requis}"
WORK_DIR="${4:?work_dir requis}"
ROOT="${5:?root_dir requis}"

# LLM STAGE2 (host) = codex CLI → llm-mesh → gpt-5.6-luna (id NU, pas d'alias). Le codex host utilise son
# enrollment LOCAL (mesh en loopback) : zéro secret cluster, zéro compte dédié. FAIL-CLOSED-si-mesh-down :
# 0 repli vers claude / OpenAI / provider-natif-codex (le hook n'appelle AUCUN autre provider). Pin luna explicite.
CODEX_MODEL="${CODEX_MODEL:-gpt-5.6-luna}"
# 2-bucket split (préprod-safe) : le worker LIT UNIQUEMENT (raw PVs + .meta.json sidecars) depuis le
# READ bucket (SCW -pocs, RO). Il ne publie JAMAIS. Fallback SCRAPE_S3_* = mode single-bucket (dev/legacy).
BUCKET="${READ_S3_BUCKET:-${SCRAPE_S3_BUCKET:-}}"
S3_URL="${READ_S3_ENDPOINT:-${SCRAPE_S3_ENDPOINT:-}}"
# Creds READ pour les s5cmd du worker (lecture seule ; jamais de publish). Defense-in-depth : en mode
# HOST (SKIP_S3_FETCH) on ne RÉFÉRENCE AUCUN cred S3 — le host ne voit que du texte public (invariant K1).
if [ -z "${SKIP_S3_FETCH:-}" ]; then
  export AWS_ACCESS_KEY_ID="${READ_AWS_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
  export AWS_SECRET_ACCESS_KEY="${READ_AWS_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[grounding/$CITY] $*"; }
err() { echo "[grounding/$CITY] ERREUR: $*" >&2; }

# ── Mode d'exécution ──────────────────────────────────────────────────────────
# SKIP_S3_FETCH=1 → mode HOST (text-split, modèle b) : le pod in-cluster (k8s) a DÉJÀ fait le fetch RO
# + pdftotext ; il fournit `$WORK_DIR/txts/<sha>.txt` + `$WORK_DIR/meta/<sha>.meta.json` + le candidate.
# Le worker host NE touche PAS S3 (aucun secret/PDF sur host) : il fait nodes-by-sha → codex+luna → build-grounded.
# Défaut (unset) = mode mono-host legacy (fetch S3 + pdftotext ici).
SKIP_S3_FETCH="${SKIP_S3_FETCH:-}"

# ── Vérifications préliminaires ───────────────────────────────────────────────
if [ ! -f "$CANDIDATE" ]; then
  err "candidat introuvable: $CANDIDATE"; exit 1
fi
if [ -z "$SKIP_S3_FETCH" ]; then
  # mono-host : besoin S3 (raw) + pdftotext.
  if [ -z "$BUCKET" ] || [ -z "$S3_URL" ]; then
    err "credentials READ manquants (READ_S3_BUCKET/READ_S3_ENDPOINT)"; exit 1
  fi
  if ! command -v pdftotext >/dev/null 2>&1; then
    err "pdftotext manquant (apt install poppler-utils)"; exit 1
  fi
fi
if ! command -v codex >/dev/null 2>&1; then
  err "codex CLI manquant (LLM STAGE2 = codex CLI + mesh + gpt-5.6-luna)"; exit 1
fi

# ── Plafond DUR d'appels LLM (cost-gate cohorte, i-cond) ──────────────────────
# MAX_LLM_CALLS (env) = nombre MAX d'appels codex sur TOUT le run, compteur PARTAGÉ entre villes via
# LLM_CALL_COUNTER_FILE (posé par drive-grounding). Vide/unset = illimité (runs host manuels, pilote).
# Réservation ATOMIQUE (flock) AVANT chaque codex exec : si le slot réservé dépasse le cap → 0 appel,
# arrêt dur. Le compteur seul tient le cap même en lanes parallèles (aucun appel au-delà de MAX).
MAX_LLM_CALLS="${MAX_LLM_CALLS:-}"
LLM_CALL_COUNTER_FILE="${LLM_CALL_COUNTER_FILE:-$WORK_DIR/llm-call-count}"
CAP_REACHED=0
llm_reserve() {  # 0 = slot réservé (appel autorisé) ; 1 = plafond atteint (ne PAS appeler)
  [ -z "${MAX_LLM_CALLS:-}" ] && return 0
  local n
  # brace-group + fd9 redirect (flock à l'intérieur) : n persiste (pas un sous-shell). Verrou inter-process
  # sur le .lock → réservation atomique même en lanes parallèles.
  {
    flock 9
    n=$(cat "$LLM_CALL_COUNTER_FILE" 2>/dev/null || echo 0); n=$((n + 1))
    printf '%s' "$n" > "$LLM_CALL_COUNTER_FILE"
  } 9>"${LLM_CALL_COUNTER_FILE}.lock"
  [ "${n:-999999}" -le "$MAX_LLM_CALLS" ]
}

# ── Discipline 429 codex (i-cond, NON-NÉGOCIABLE, prérequis wave cohorte) ─────
# Le gateway NE protège PAS le pool codex sur 429 : proxy-openai = pass-through, 0 cool/rebind/backoff
# (vérifié h-runtime en source ; markAccountExhausted n'existe que côté proxy-anthropic). Sans marquage
# d'épuisement, le compte reste ÉLIGIBLE → un retry le re-sélectionne (round-robin) → re-429 → MARTÈLEMENT
# du même compte (faux failover) qui dégrade codex POUR TOUTES LES LANES. ⇒ discipline CLIENT obligatoire:
#   (a) concurrence=1 fleet-wide : flock sérialise CHAQUE codex exec (aucun 2e appel en vol).
#   (b) 1er 429 = STOP DUR GLOBAL run-entier : flag partagé → 0 appel sur toute ville/docSha restant.
#   (c) 0 retry auto sur 429 : classification de l'erreur AVANT tout re-essai.
# FAIL-SAFE : le codex CLI n'expose PAS de façon garantie le status HTTP par-appel (surface 429 = source-gap
# côté h-runtime). Défaut conservateur (CODEX_429_SURFACE_KNOWN!=1) = tout codex exit≠0 = POTENTIEL 429 →
# stop-dur, 0 retry (un blip mesh transitoire stoppe le run = acceptable ; run resumable/caché ; « 1er 429
# dégrade la flotte » domine). NB: exit0 + JSON vide = requête ABOUTIE (pas un rate-limit) → retry formatage
# sûr conservé (la règle « 0 retry » vise le 429, pas un raté de format). Refinement futur : surface 429
# confirmée (CODEX_429_SURFACE_KNOWN=1 + CODEX_429_PATTERN précis) ⇒ n'arrêter que sur signature réelle,
# retry non-429 (500/502/timeout/réseau) ré-autorisé — voir la branche `else` de classification plus bas.
# SPEC SURFACE 429 (h-runtime, source gateway proxy-openai.ts:1493-1502) :
#   • SIGNAL FIABLE = HTTP 429 + `error.code`/`error.type` du BODY upstream propagé VERBATIM
#     (`rate_limit_exceeded` | `insufficient_quota`) → discriminant du pattern ci-dessous.
#   • retry-after + x-ratelimit-* NE SONT PAS propagés (drop, ≠ proxy-anthropic) ⇒ pas un signal ; avec
#     start=1 + 1er-429=STOP-DUR il n'est pas requis (detect_retry_after reste best-effort pour le log seul).
#   • Le 429 court-circuite AVANT la traduction codex→anthropic (pass-through) ⇒ pas d'attestation x-h2a sur l'erreur.
#   • SURFACE CLI (exit/stderr/event --json, wrapper codex.mjs champs stderrMessage/message/phase) NON affirmée
#     en source ⇒ à CONFIRMER EMPIRIQUEMENT au ramp concurrence-1 ; le fail-safe la rend sûre sans pré-caractérisation.
CODEX_SERIAL_LOCK="${CODEX_SERIAL_LOCK:-${LLM_CALL_COUNTER_FILE}.codex-serial.lock}"
CODEX_429_STOP_FLAG="${CODEX_429_STOP_FLAG:-${LLM_CALL_COUNTER_FILE}.codex-429-stop}"
# error.code fiables (rate_limit_exceeded/insufficient_quota) + variantes larges ; retry-after RETIRÉ du
# signal (droppé par le gateway ⇒ n'apparaît pas sur un vrai 429, éviter un faux positif).
CODEX_429_PATTERN="${CODEX_429_PATTERN:-429|too many requests|rate.?limit|rate_limited|rate_limit_exceeded|insufficient_quota|resource_exhausted|quota|overloaded}"
CODEX_429_SURFACE_KNOWN="${CODEX_429_SURFACE_KNOWN:-0}"
CODEX_STOP=0
codex_429_stopped() { [ -e "$CODEX_429_STOP_FLAG" ]; }
set_codex_429_stop() {  # $1=sha $2=signature $3=retry-after — append atomique O_APPEND sur le flag partagé
  { printf 'city=%s sha=%s sig=%s retry_after=%s ts=%s\n' \
      "$CITY" "${1:-}" "${2:-}" "${3:-}" "$(date -u +%FT%TZ)" >> "$CODEX_429_STOP_FLAG"; } 2>/dev/null || true
}
detect_429() {  # echo le 1er token de signature rate-limit trouvé dans les fichiers passés, sinon vide
  local hit; hit="$(grep -hioE "$CODEX_429_PATTERN" "$@" 2>/dev/null | head -1 || true)"; printf '%s' "$hit"
}
detect_retry_after() {  # echo une valeur retry-after (secondes) si présente, sinon vide
  grep -hioE 'retry.?after[":= ]+[0-9]+' "$@" 2>/dev/null | grep -oE '[0-9]+' | head -1 || true
}

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

# 1) docSha sur props OU refs niveau-nœud (les nœuds re-propagation portent le docSha dans n["refs"], pas dans props)
for n in g["nodes"]:
    if n.get("type") in ("DesignationEvent", "Signal"):
        ds = (n.get("properties") or {}).get("docSha")
        if not ds:
            ds = next((r.get("docSha") for r in (n.get("refs") or []) if isinstance(r, dict) and r.get("docSha")), None)
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

if [ -z "$SKIP_S3_FETCH" ]; then
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
  if pdftotext -layout -enc UTF-8 "$pdf" "$raw_txt" 2>/dev/null; then  # -enc UTF-8 : aligné STAGE1 (accents FR)
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

else
  # ── Mode HOST (SKIP_S3_FETCH) : k8s a fourni txts/ + meta/ in-cluster. Fail-closed si absents. ──
  log "Mode HOST (text-split) : fetch S3 + pdftotext SAUTÉS (fournis par le pod in-cluster)"
  n_txt=$(find "$WORK_DIR/txts" -name '*.txt' -type f 2>/dev/null | wc -l)
  if [ "${n_txt:-0}" -eq 0 ]; then
    err "Mode HOST : aucun txts/<sha>.txt fourni dans $WORK_DIR/txts — k8s doit livrer les txtp d'abord"; exit 1
  fi
  log "  $n_txt txts/<sha>.txt fournis ; $(find "$WORK_DIR/meta" -name '*.meta.json' 2>/dev/null | wc -l) meta sidecars"
fi

# ── 4. Extraction citations LLM (codex CLI → mesh → gpt-5.6-luna) ─────────────
log "Étape 4: extraction citations verbatim (codex+mesh+luna, fail-closed-si-down)"

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
  events="$WORK_DIR/cites/${sha}.events.jsonl"
  errf="$WORK_DIR/cites/${sha}.err.txt"
  # ── LLM = codex exec → mesh → gpt-5.6-luna ────────────────────────────────
  # FAIL-CLOSED-si-mesh-down : si codex/mesh échoue (exit≠0) on RETRY le MÊME chemin (mesh) ; on n'appelle
  # JAMAIS claude / OpenAI / un provider natif codex de repli. En dernier recours (3 échecs) → cites vides
  # → 7bis bloque le nœud (pas de fausse citation). `-s read-only` : aucune commande exécutable. `--json`
  # capture les events (preuve served-model). `--output-last-message` = réponse finale propre (le JSON).
  # ANTI-EXFILTRATION (garantie de NIVEAU ENROLLMENT) : le « 0 repli provider natif » repose sur le fait que
  # l'enrollment codex du HOST a le mesh comme SEUL provider (aucune clé OpenAI de repli). Le served-model
  # PAR-APPEL N'EST PAS exposé par le codex CLI (diagnostic mesuré : `--json` = events thread `type`/`thread_id`,
  # PAS les headers HTTP mesh type X-Sentropic-Served) → pas de preuve-luna grep-able ici. ⟹ item à confirmer
  # côté enrollment (lane mesh) : le codex host ne DOIT avoir aucun fallback OpenAI. `-m gpt-5.6-luna` = pin explicite.
  # ── Pré-check 429 GLOBAL : si un 429 a déjà stoppé le run (n'importe quelle ville/lane) → 0 appel. ──
  if codex_429_stopped; then
    log "  [429-STOP] arrêt dur 429 global actif (voir $CODEX_429_STOP_FLAG) — 0 appel ($sha)"
    CODEX_STOP=1; break
  fi
  llm_ok=0
  for attempt in 1 2 3; do
    if codex_429_stopped; then CODEX_STOP=1; break; fi
    if ! llm_reserve; then
      log "  [CAP] MAX_LLM_CALLS=$MAX_LLM_CALLS atteint — arrêt dur AVANT appel ($sha)"; CAP_REACHED=1; break
    fi
    : > "$raw_resp"; : > "$events"; : > "$errf"
    # (a) concurrence=1 fleet-wide : flock -x sur le lock partagé sérialise CHAQUE codex exec (fd 8).
    rc=0
    { flock -x 8; timeout 360 codex exec -m "$CODEX_MODEL" -s read-only --skip-git-repo-check --ephemeral \
         --color never --json -C "$WORK_DIR" --output-last-message "$raw_resp" - \
         < "$prompt_file" > "$events" 2>"$errf"; } 8>"$CODEX_SERIAL_LOCK" || rc=$?
    if [ "$rc" = "0" ]; then
      if grep -q '{' "$raw_resp" 2>/dev/null && [ -s "$raw_resp" ]; then
        log "  [ok-llm] $sha: réponse codex+mesh OK"; llm_ok=1; break
      fi
      # exit0 + JSON vide = requête ABOUTIE (pas un rate-limit) → retry formatage sûr (règle « 0 retry » = 429 only).
      log "  [retry-llm] $sha: tentative $attempt réponse vide/sans JSON (exit0, pas un 429)"; continue
    fi
    # exit≠0 = chemin ERREUR HTTP codex → RISQUE POOL (429 pass-through NON protégé par le gateway).
    sig="$(detect_429 "$errf" "$events" "$raw_resp")"
    ra="$(detect_retry_after "$errf" "$events")"
    if [ -n "$sig" ]; then
      log "  [429] $sha: signature rate-limit ('$sig'${ra:+, retry-after=$ra}) → (b) STOP DUR global + (c) 0 retry"
      set_codex_429_stop "$sha" "$sig" "$ra"; CODEX_STOP=1; break
    elif [ "$CODEX_429_SURFACE_KNOWN" != "1" ]; then
      # FAIL-SAFE (surface 429 non confirmée empiriquement) : tout exit≠0 = POTENTIEL 429 → stop-dur, 0 retry.
      log "  [429-failsafe] $sha: codex exit=$rc non classé${ra:+ retry-after=$ra} → FAIL-SAFE stop-dur (surface 429 non confirmée), 0 retry"
      set_codex_429_stop "$sha" "exit$rc" "$ra"; CODEX_STOP=1; break
    else
      # surface CONFIRMÉE + non-429 (500/502/timeout/réseau) → retry fail-closed autorisé (≤3).
      log "  [retry-llm] $sha: tentative $attempt codex exit=$rc non-429 (surface connue) — retry fail-closed"; continue
    fi
  done
  if [ "$CAP_REACHED" = "1" ]; then
    log "Étape 4 STOPPÉE au plafond MAX_LLM_CALLS=$MAX_LLM_CALLS — nœuds restants non groundés (cost-gate cohorte)."
    break
  fi
  if [ "${CODEX_STOP:-0}" = "1" ]; then
    log "Étape 4 STOPPÉE — 429/erreur codex : arrêt dur anti-martèlement pool (run resumable/caché ; sha $sha non groundé)."
    break
  fi
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
    log "  [WARN-llm] $sha: réponse vide après retries (non-429) → cites vides (7bis bloquera le nœud, pas de fausse citation)"
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
