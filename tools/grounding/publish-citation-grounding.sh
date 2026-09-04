#!/usr/bin/env bash
# Publish a citation-grounded graph to S3 with non-destructive backup.
# Usage: publish-citation-grounding.sh <city> <candidate_json> <run_dir> [lane_id]
set -euo pipefail
CITY="${1:?city requis}"
CAND="${2:?candidate_json requis}"
RUN="${3:?run_dir requis}"
LANE="${4:-manual}"

# .env sourcé UNIQUEMENT s'il existe (dev/local) ; in-cluster les vars viennent des secretRef montés.
if [ -f .env ]; then set -a; source .env; set +a; fi
# ── Cible publish = PUBLISH_* (fallback SCRAPE_S3_*). Single-bucket est le mode NORMAL : le graph store
#    graph/<city>/latest.json et les docs source raw/ partagent le bucket docs-pocs. La frontière de
#    sûreté est le PRÉFIXE (garde plus bas au point d'écriture), PAS le nom du bucket. Fail-closed si
#    une creds PUBLISH_* manque (rien ne tourne à moitié configuré → publish silencieux au mauvais endroit). ──
PUBLISH_S3_ENDPOINT="${PUBLISH_S3_ENDPOINT:-${SCRAPE_S3_ENDPOINT:-}}"
PUBLISH_S3_BUCKET="${PUBLISH_S3_BUCKET:-${SCRAPE_S3_BUCKET:-}}"
PUBLISH_AWS_ACCESS_KEY_ID="${PUBLISH_AWS_ACCESS_KEY_ID:-${SCRAPE_S3_ACCESS_KEY:-}}"
PUBLISH_AWS_SECRET_ACCESS_KEY="${PUBLISH_AWS_SECRET_ACCESS_KEY:-${SCRAPE_S3_SECRET_KEY:-}}"
for v in PUBLISH_S3_ENDPOINT PUBLISH_S3_BUCKET PUBLISH_AWS_ACCESS_KEY_ID PUBLISH_AWS_SECRET_ACCESS_KEY; do
  [ -z "${!v:-}" ] && { echo "publish-citation-grounding: FAIL-CLOSED — $v vide (PUBLISH_* requis)." >&2; exit 2; }
done
export AWS_ACCESS_KEY_ID="$PUBLISH_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$PUBLISH_AWS_SECRET_ACCESS_KEY"
export AWS_REGION="${SCRAPE_S3_REGION:-us-east-1}"
S3_URL="$PUBLISH_S3_ENDPOINT"
BUCKET="$PUBLISH_S3_BUCKET"
mkdir -p "$RUN/logs" "$RUN/status"

python3 - "$CAND" <<'PY'
import json, sys
p = sys.argv[1]
g = json.load(open(p))
bad = []
for n in g.get('nodes', []):
    if n.get('type') in ('Signal', 'DesignationEvent'):
        prop = n.get('properties') or {}
        c = prop.get('citation') or ''
        page = prop.get('page')
        if c and (not isinstance(page, int) or page <= 0):
            bad.append(n.get('id'))
print('cited', sum(1 for n in g.get('nodes', [])
                   if n.get('type') in ('Signal', 'DesignationEvent')
                   and (n.get('properties') or {}).get('citation')))
if bad:
    print('bad page', bad[:10])
    sys.exit(1)
PY

ts="$(date -u +%Y%m%dT%H%M%SZ)"
parsed="s3://$BUCKET/parsed/$CITY/grounding-citations/$LANE/latest.candidate.json"
graph="s3://$BUCKET/graph/$CITY/latest.json"
backup="s3://$BUCKET/graph/$CITY/history/pre-citation-grounding-${LANE}-${ts}.json"

# ── FAIL-CLOSED prefix-safety : on n'écrit QUE dans les zones publish graph/ + parsed/ ; JAMAIS la
#    zone READ (raw/proces-verbaux, .meta) — même bucket, préfixes disjoints. Allowlist POSITIVE :
#    toute clé hors graph/|parsed/ arrête la publication AVANT le moindre cp. ──
for _k in "$parsed" "$graph" "$backup"; do
  case "${_k#s3://$BUCKET/}" in
    graph/*|parsed/*) : ;;
    *) echo "publish-citation-grounding: FAIL-CLOSED — clé hors zone d'écriture (graph/|parsed/), refuse d'approcher la zone READ raw/.meta : $_k" >&2; exit 2 ;;
  esac
done

s5cmd --endpoint-url "$S3_URL" cp "$CAND" "$parsed" >>"$RUN/logs/publish-$CITY.log" 2>&1

# Backup obligatoire avant d'écraser la clé canonique. `s5cmd ls` sort non-zéro
# pour « objet absent » COMME pour une erreur réseau / d'autorisation : traiter
# les deux comme « absent » publiait sans archive et détruisait la version
# précédente. Toute sonde ambiguë arrête la publication (fail-closed).
ls_out="$(s5cmd --endpoint-url "$S3_URL" ls "$graph" 2>&1)" && ls_rc=0 || ls_rc=$?
printf '%s\n' "$ls_out" >>"$RUN/logs/publish-$CITY.log"
if [ "$ls_rc" -eq 0 ]; then
  s5cmd --endpoint-url "$S3_URL" cp "$graph" "$backup" >>"$RUN/logs/publish-$CITY.log" 2>&1
elif printf '%s' "$ls_out" | grep -qiE 'no object found|NoSuchKey|not found'; then
  backup="(aucun: $graph absent)"
else
  echo "publish-citation-grounding: sonde backup ambiguë pour $graph — publication annulée" >&2
  exit 1
fi
s5cmd --endpoint-url "$S3_URL" cp "$CAND" "$graph" >>"$RUN/logs/publish-$CITY.log" 2>&1
jq -cn --arg city "$CITY" --arg backup "$backup" --arg graph "$graph" --arg parsed "$parsed" --arg ts "$ts" \
  '{city:$city,published:true,backup:$backup,graph:$graph,parsed:$parsed,at:$ts}' >> "$RUN/status/manual-publish.jsonl"
echo "$backup"
