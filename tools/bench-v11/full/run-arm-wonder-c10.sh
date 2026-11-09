#!/bin/bash
# Concurrency-10 continuation, strictly same muse command as run-arm-wonder.sh
DIR=/home/antoinefa/src/radar-immobilier-bench/tmp/bench-wonder/full
ARM="muse-wonder-low"
ARMDIR="$DIR/arms/$ARM"
mkdir -p "$ARMDIR/raw"
MANIFEST="$DIR/../harness/manifest-v101b.json"
export DIR ARMDIR ARM

run_doc() {
  DOC="$1"
  EFFORT="low"
  OUT="$ARMDIR/raw/${EFFORT}--${DOC}.txt"
  if [ -s "$OUT" ]; then echo "skip $DOC"; return 0; fi
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
    if [ $CODE -ne 0 ] && grep -qiE "429|rate.?limit|overloaded|quota|capacity|usage limit" "$OUT.stderr" && [ $ATTEMPT -le 12 ]; then
      echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"event\":\"QUOTA\",\"attempt\":$ATTEMPT,\"ms\":$MS}" >> "$ARMDIR/meta.jsonl"
      rm -f "$OUT"
      sleep 300
      continue
    fi
    # also check stdout for quota text when exit 0 but empty/error payload
    if grep -qiE "429|rate.?limit|usage limit" "$OUT.stderr" && [ $ATTEMPT -le 12 ]; then
      echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"event\":\"QUOTA\",\"attempt\":$ATTEMPT,\"ms\":$MS}" >> "$ARMDIR/meta.jsonl"
      rm -f "$OUT"
      sleep 300
      continue
    fi
    if [ "$BYTES" -eq 0 ] && [ $CODE -ne 0 ]; then
      rm -f "$OUT"
    fi
    echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"exit\":$CODE,\"ms\":$MS,\"attempt\":$ATTEMPT,\"bytes\":$BYTES}" >> "$ARMDIR/meta.jsonl"
    echo "done $DOC exit=$CODE ms=$MS bytes=$BYTES attempt=$ATTEMPT"
    break
  done
}
export -f run_doc

DOCS=$(node -e 'const m=require(process.argv[1]);console.log(m.documents.map(d=>d.id).join("\n"))' "$MANIFEST")
# only missing (no non-empty raw)
MISSING=""
for D in $DOCS; do [ -s "$ARMDIR/raw/low--${D}.txt" ] || MISSING="$MISSING $D"; done
echo "missing: $(echo $MISSING | wc -w)"
printf "%s\n" $MISSING | xargs -P 10 -I{} bash -c 'run_doc "$@"' _ {}
echo "{\"arm\":\"$ARM\",\"event\":\"ARM-DONE-C10\"}" >> "$ARMDIR/meta.jsonl"
echo "ALL DONE"
wc -l "$ARMDIR/meta.jsonl"; ls "$ARMDIR/raw"/*.txt | grep -v stderr | wc -l
