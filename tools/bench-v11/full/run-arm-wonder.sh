#!/bin/bash
# bench-v11: one Muse 1.3 seat arm (muse CLI, subscription, no API key).
# Usage: run-arm-muse.sh <effort>   (minimal|low|medium|high|xhigh|max)
# Resume-safe: docs with a completed raw output are skipped.
EFFORT="$1"
DIR=/home/antoinefa/src/radar-immobilier-bench/tmp/bench-wonder/full
ARM="muse-wonder-${EFFORT}"
ARMDIR="$DIR/arms/$ARM"
mkdir -p "$ARMDIR/raw"
MANIFEST="$DIR/../harness/manifest-v101b.json"
DOCS=$(node -e 'const m=require(process.argv[1]);console.log(m.documents.map(d=>d.id).join("\n"))' "$MANIFEST")

for DOC in $DOCS; do
  OUT="$ARMDIR/raw/${EFFORT}--${DOC}.txt"
  if [ -s "$OUT" ]; then
    continue
  fi
  ATTEMPT=0
  while true; do
    ATTEMPT=$((ATTEMPT+1))
    START=$(date +%s%3N)
    timeout 1200 muse exec --provider meta --model muse-wonder-1.0 \
      --reasoning-effort "$EFFORT" --prompt-file "$DIR/prompts/${DOC}.muse.txt" \
      > "$OUT" 2> "$OUT.stderr"
    CODE=$?
    END=$(date +%s%3N)
    MS=$((END-START))
    BYTES=$(wc -c < "$OUT")
    if [ $CODE -ne 0 ] && grep -qiE "429|rate.?limit|overloaded|quota|capacity" "$OUT.stderr" && [ $ATTEMPT -le 12 ]; then
      echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"event\":\"QUOTA\",\"attempt\":$ATTEMPT,\"ms\":$MS}" | tee -a "$ARMDIR/meta.jsonl"
      rm -f "$OUT"
      sleep 300
      continue
    fi
    if [ "$BYTES" -eq 0 ] && [ $CODE -ne 0 ]; then
      rm -f "$OUT"
    fi
    echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"exit\":$CODE,\"ms\":$MS,\"attempt\":$ATTEMPT,\"bytes\":$BYTES}" | tee -a "$ARMDIR/meta.jsonl"
    break
  done
done
echo "{\"arm\":\"$ARM\",\"event\":\"ARM-DONE\"}" | tee -a "$ARMDIR/meta.jsonl"
