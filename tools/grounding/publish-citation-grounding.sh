#!/usr/bin/env bash
# Publish a citation-grounded graph to S3 with non-destructive backup.
# Usage: publish-citation-grounding.sh <city> <candidate_json> <run_dir> [lane_id]
set -euo pipefail
CITY="${1:?city requis}"
CAND="${2:?candidate_json requis}"
RUN="${3:?run_dir requis}"
LANE="${4:-manual}"

set -a
source .env
set +a
export AWS_ACCESS_KEY_ID="${SCRAPE_S3_ACCESS_KEY}"
export AWS_SECRET_ACCESS_KEY="${SCRAPE_S3_SECRET_KEY}"
export AWS_REGION="${SCRAPE_S3_REGION}"
S3_URL="${SCRAPE_S3_ENDPOINT}"
BUCKET="${SCRAPE_S3_BUCKET}"
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

s5cmd --endpoint-url "$S3_URL" cp "$CAND" "$parsed" >>"$RUN/logs/publish-$CITY.log" 2>&1
if s5cmd --endpoint-url "$S3_URL" ls "$graph" >>"$RUN/logs/publish-$CITY.log" 2>&1; then
  s5cmd --endpoint-url "$S3_URL" cp "$graph" "$backup" >>"$RUN/logs/publish-$CITY.log" 2>&1
fi
s5cmd --endpoint-url "$S3_URL" cp "$CAND" "$graph" >>"$RUN/logs/publish-$CITY.log" 2>&1
jq -cn --arg city "$CITY" --arg backup "$backup" --arg graph "$graph" --arg parsed "$parsed" --arg ts "$ts" \
  '{city:$city,published:true,backup:$backup,graph:$graph,parsed:$parsed,at:$ts}' >> "$RUN/status/manual-publish.jsonl"
echo "$backup"
