#!/bin/bash
# bench-v11 burn + usage capture: Muse Wonder low, 10 frozen docs, sequential.
# Same frozen prompts and same muse command as run-arm-wonder.sh, plus --json
# so the provider usage (tokens + seat allowance) is recorded per document.
# Seat quota is never a refusal: wait 300 s and resume (max 12 attempts).
DIR="${BENCH_DIR:-$(cd "$(dirname "$0")/.." && pwd)}/full"
OUTDIR="$DIR/burn-usage-wonder-followup10"
mkdir -p "$OUTDIR"
MANIFEST="$DIR/../harness/manifest-v101b.json"
DOCS=$(node -e 'const m=require(process.argv[1]);console.log(m.documents.slice(0,10).map(d=>d.id).join("\n"))' "$MANIFEST")

for DOC in $DOCS; do
  JSONL="$OUTDIR/${DOC}.jsonl"
  if [ -s "$OUTDIR/${DOC}.usage.json" ]; then echo "skip $DOC"; continue; fi
  ATTEMPT=0
  while true; do
    ATTEMPT=$((ATTEMPT+1))
    START=$(date +%s%3N)
    timeout 1200 muse exec --provider meta --model muse-wonder-1.0 \
      --reasoning-effort low --prompt-file "$DIR/prompts/${DOC}.muse.txt" --json \
      > "$JSONL" 2> "$JSONL.stderr"
    CODE=$?
    END=$(date +%s%3N)
    MS=$((END-START))
    if [ $CODE -ne 0 ] && grep -qiE "429|rate.?limit|overloaded|quota|capacity|usage limit" "$JSONL.stderr" && [ $ATTEMPT -le 12 ]; then
      echo "{\"arm\":\"muse-wonder-low-usage-followup10\",\"doc\":\"$DOC\",\"event\":\"QUOTA\",\"attempt\":$ATTEMPT,\"ms\":$MS}" >> "$OUTDIR/meta.jsonl"
      rm -f "$JSONL"
      sleep 300
      continue
    fi
    node "$DIR/extract-usage.mjs" "$JSONL" "$OUTDIR/${DOC}.txt" "$OUTDIR/${DOC}.usage.json" > "$OUTDIR/${DOC}.extract.log" 2>&1
    echo "{\"arm\":\"muse-wonder-low-usage-followup10\",\"doc\":\"$DOC\",\"exit\":$CODE,\"ms\":$MS,\"attempt\":$ATTEMPT}" >> "$OUTDIR/meta.jsonl"
    echo "done $DOC exit=$CODE ms=$MS attempt=$ATTEMPT"
    break
  done
done
echo "{\"arm\":\"muse-wonder-low-usage-followup10\",\"event\":\"BURN-DONE\"}" >> "$OUTDIR/meta.jsonl"
echo "BURN DONE"
