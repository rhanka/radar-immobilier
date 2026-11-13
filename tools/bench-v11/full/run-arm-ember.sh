#!/bin/bash
# bench-v11: Muse Ember arm (muse-ember-1.0, Muse seat, no API key).
# Usage: run-arm-ember.sh <effort> [concurrency]   (effort: xhigh|max ; default concurrency 4)
# Same frozen prompts and same muse command as run-arm-wonder.sh /
# run-arm-wonder-c10.sh, with two additions:
#   --contributor-mode off : pins the public model id (with --preset empty the
#     CLI resolves muse-ember-1.0 to the hidden *-contributor variant, which the
#     seat cannot access ; checked on 2026-11-13 that the arm command below
#     resolves to model_id "muse-ember-1.0" with and without the flag).
#   --json : real provider usage (tokens + seat allowance) on every document,
#     as in run-burn-wonder-usage10.sh ; the terminal text is extracted by
#     extract-usage.mjs into raw/<effort>--<doc>.txt for the v9 validator.
# Seat quota is never a refusal: wait 300 s and resume (max 12 attempts).
# Weekly guard: before each document, and after each document from the
# run.usage allowance, the arm stops when the weekly seat counter reaches
# STOP_WEEKLY_PCT (default 85). A STOP file in the arm dir also stops it.
# Resume-safe: documents with a completed usage file are skipped.
EFFORT="$1"
CONC="${2:-4}"
case "$EFFORT" in xhigh|max) ;; *) echo "effort must be xhigh or max" >&2; exit 2;; esac
DIR="${BENCH_DIR:-$(cd "$(dirname "$0")/.." && pwd)}/full"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ARM="muse-ember-${EFFORT}"
ARMDIR="$DIR/arms/$ARM"
STOP_WEEKLY_PCT="${STOP_WEEKLY_PCT:-85}"
# muse working directory: an empty neutral directory, as for the Wonder arm
# (its stderr records "workspace root: /tmp/wonder-run"), so no project rules
# or skills from a repository checkout enter the CLI context. Keep it outside
# any git checkout (the CLI reads rules files from its workspace root).
RUN_CWD="${MUSE_CWD:-${TMPDIR:-/tmp}/muse-ember-run}"
mkdir -p "$ARMDIR/raw" "$ARMDIR/jsonl" "$ARMDIR/usage" "$RUN_CWD"
# Guard (added 2026-11-13, after the published runs, which used an empty
# directory): refuse a non-empty CLI working directory.
if [ -n "$(ls -A "$RUN_CWD" 2>/dev/null)" ]; then
  echo "MUSE_CWD $RUN_CWD is not empty: refusing to run" >&2
  exit 3
fi
MANIFEST="$DIR/../harness/manifest-v101b.json"
export DIR SCRIPTS ARMDIR ARM EFFORT STOP_WEEKLY_PCT RUN_CWD

weekly_pct() {
  muse usage --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(o.allowance?.weekly?.usedPercent ?? "")}catch{console.log("")}})'
}
export -f weekly_pct

run_doc() {
  DOC="$1"
  USAGE="$ARMDIR/usage/${EFFORT}--${DOC}.usage.json"
  OUT="$ARMDIR/raw/${EFFORT}--${DOC}.txt"
  JSONL="$ARMDIR/jsonl/${EFFORT}--${DOC}.jsonl"
  if [ -s "$USAGE" ]; then echo "skip $DOC"; return 0; fi
  if [ -e "$ARMDIR/STOP" ]; then echo "stop-file $DOC"; return 0; fi
  W=$(weekly_pct)
  if [ -n "$W" ] && [ "$W" -ge "$STOP_WEEKLY_PCT" ]; then
    echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"event\":\"WEEKLY-STOP\",\"weeklyUsedPercent\":$W,\"at\":\"$(date -u +%FT%TZ)\"}" >> "$ARMDIR/meta.jsonl"
    touch "$ARMDIR/STOP"
    return 0
  fi
  PSHA=$(sha256sum "$DIR/prompts/${DOC}.muse.txt" | cut -d' ' -f1)
  ATTEMPT=0
  while true; do
    ATTEMPT=$((ATTEMPT+1))
    STARTED=$(date -u +%FT%T.%3NZ)
    START=$(date +%s%3N)
    ( cd "$RUN_CWD" && timeout 1200 muse exec --provider meta --model muse-ember-1.0 --contributor-mode off \
      --reasoning-effort "$EFFORT" --prompt-file "$DIR/prompts/${DOC}.muse.txt" --json ) \
      > "$JSONL" 2> "$JSONL.stderr"
    CODE=$?
    END=$(date +%s%3N)
    MS=$((END-START))
    if grep -qiE "429|rate.?limit|overloaded|quota|capacity|usage limit" "$JSONL.stderr" && [ $ATTEMPT -le 12 ]; then
      echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"event\":\"QUOTA\",\"attempt\":$ATTEMPT,\"exit\":$CODE,\"ms\":$MS,\"startedAt\":\"$STARTED\"}" >> "$ARMDIR/meta.jsonl"
      rm -f "$JSONL"
      sleep 300
      continue
    fi
    node "$SCRIPTS/extract-usage.mjs" "$JSONL" "$OUT" "$USAGE.tmp" > /dev/null 2>&1
    TERM=$(node -e 'const fs=require("fs");let t="none",r=null,m=null;for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){try{const o=JSON.parse(l);if(o.payload_type==="run.terminal.completed"){t=o.payload?.terminal??"none";r=o.payload?.reason??null}if(o.payload_type==="run.model.configured")m=o.payload?.model_id??null}catch{}}console.log(JSON.stringify({terminal:t,reason:r,modelId:m}))' "$JSONL" 2>/dev/null)
    [ -z "$TERM" ] && TERM='{"terminal":"none","reason":null,"modelId":null}'
    if echo "$TERM" | grep -qiE "429|rate.?limit|overloaded|quota|usage limit" && [ $ATTEMPT -le 12 ]; then
      echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"event\":\"QUOTA\",\"attempt\":$ATTEMPT,\"exit\":$CODE,\"ms\":$MS,\"startedAt\":\"$STARTED\",\"term\":$TERM}" >> "$ARMDIR/meta.jsonl"
      rm -f "$JSONL" "$OUT" "$USAGE.tmp"
      sleep 300
      continue
    fi
    BYTES=$(wc -c < "$OUT" 2>/dev/null || echo 0)
    if [ "$BYTES" -eq 0 ] && [ $CODE -ne 0 ]; then
      rm -f "$OUT"
    fi
    mv -f "$USAGE.tmp" "$USAGE" 2>/dev/null
    WK=$(node -e 'try{const u=require(process.argv[1]);console.log(u.allowance?.weekly?.used_percent ?? "null")}catch{console.log("null")}' "$USAGE")
    echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"exit\":$CODE,\"ms\":$MS,\"attempt\":$ATTEMPT,\"bytes\":$BYTES,\"promptSha256\":\"$PSHA\",\"startedAt\":\"$STARTED\",\"weeklyUsedPercent\":$WK,\"term\":$TERM}" >> "$ARMDIR/meta.jsonl"
    echo "done $DOC exit=$CODE ms=$MS bytes=$BYTES attempt=$ATTEMPT weekly=$WK"
    if [ "$WK" != "null" ] && [ "$WK" -ge "$STOP_WEEKLY_PCT" ]; then
      echo "{\"arm\":\"$ARM\",\"doc\":\"$DOC\",\"event\":\"WEEKLY-STOP\",\"weeklyUsedPercent\":$WK,\"at\":\"$(date -u +%FT%TZ)\"}" >> "$ARMDIR/meta.jsonl"
      touch "$ARMDIR/STOP"
    fi
    break
  done
}
export -f run_doc

DOCS=$(node -e 'const m=require(process.argv[1]);console.log(m.documents.map(d=>d.id).join("\n"))' "$MANIFEST")
MISSING=""
for D in $DOCS; do [ -s "$ARMDIR/usage/${EFFORT}--${D}.usage.json" ] || MISSING="$MISSING $D"; done
echo "missing: $(echo $MISSING | wc -w) weekly-before: $(weekly_pct)%"
printf "%s\n" $MISSING | xargs -P "$CONC" -I{} bash -c 'run_doc "$@"' _ {}
if [ -e "$ARMDIR/STOP" ]; then
  echo "{\"arm\":\"$ARM\",\"event\":\"ARM-STOPPED\",\"at\":\"$(date -u +%FT%TZ)\"}" >> "$ARMDIR/meta.jsonl"
  echo "STOPPED"
else
  echo "{\"arm\":\"$ARM\",\"event\":\"ARM-DONE-C${CONC}\",\"at\":\"$(date -u +%FT%TZ)\"}" >> "$ARMDIR/meta.jsonl"
  echo "ALL DONE"
fi
echo "weekly-after: $(weekly_pct)%"
ls "$ARMDIR/usage"/*.usage.json 2>/dev/null | wc -l
