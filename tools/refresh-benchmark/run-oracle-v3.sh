#!/bin/sh
# Oracle v3, full sequential chain in one command (owner order), resumable at every step:
#   astra-pass1 -> astra-pass2 -> fable-pass1 -> fable-pass2 -> gemini-pass1 -> gemini-pass2
#   -> converge-astra, converge-fable, converge-gemini -> build (consensus, disputed, calibration)
#   -> score (scores-100.json, tableau-f1-100.md)
#
#   ORACLE_V3_GO=1 ORACLE_V3_ASTRA_GO=1 tools/refresh-benchmark/run-oracle-v3.sh [first-step]
#
# A step that leaves documents undone (failure, seat limit, weekly Claude counter > 40 %) stops the
# chain with exit 3: rerun the same command, finished documents are skipped. MESH_CONCURRENCY
# (default 2) and CLAUDE_CONCURRENCY (default 4, capped at 4) tune the parallelism.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
: "${ORACLE_V3_USAGE_SCRIPT:=/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-radar-immobilier--lanes-conductor/d20c28db-f8d7-461c-be0c-99bae94b93df/scratchpad/usage.sh}"
export ORACLE_V3_USAGE_SCRIPT
STEPS="astra-pass1 astra-pass2 fable-pass1 fable-pass2 gemini-pass1 gemini-pass2 converge-astra converge-fable converge-gemini"
start="${1:-astra-pass1}"; started=0
for step in $STEPS; do
  [ "$step" = "$start" ] && started=1
  [ "$started" = 1 ] || continue
  echo "== $step $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  case "$step" in
    fable-*|converge-fable)
      node tools/refresh-benchmark/oracle-v3-step.mjs "$step" --concurrency "${CLAUDE_CONCURRENCY:-4}" ;;
    *)
      tools/refresh-benchmark/run-oracle-v3-mesh.sh "$step" --concurrency "${MESH_CONCURRENCY:-2}" ;;
  esac
  summary="docs/reviews/refresh-benchmark/v101b/oracle-v3/annotations/$step/_summary.json"
  if ! node -e 'const s=require(process.argv[1]); process.exit(s.stopped||s.failed||s.notReady?3:0)' "$ROOT/$summary"; then
    echo "run-oracle-v3: $step incomplete, see $summary; rerun to resume" >&2; exit 3
  fi
done
node tools/refresh-benchmark/oracle-v3-build.mjs
node tools/refresh-benchmark/score-oracle-v3.mjs
