#!/usr/bin/env bash
# gate-candidate.sh — GATE de non-régression B′ d'un lot vivier candidat.
#
# Prend une projection graph_nodes CANDIDATE (NDJSON, mêmes clés que le dump
# prod PG) et la baseline (snapshot d'appartenance de `main` sur la baseline
# prod), rejoue l'appartenance B′ du candidat, et diffe les BASCULES par id.
#
# Critère PASS (recette) : ZÉRO sortant sur les axes bprime ET precoce
# (hard-block, sauf correction nommée hors de ce script). Les entrants sont
# rapportés (soft-review). Code retour ≠ 0 s'il reste des sortants.
#
# Usage :
#   RECETTE_BASELINE_SNAP=<baseline-snapshot.ndjson> \
#     scripts/recette/gate-candidate.sh <candidate-projection.ndjson> [gold-expected.json]
set -uo pipefail

CAND_PROJ="${1:?usage: gate-candidate.sh <candidate-projection.ndjson> [expected.json]}"
GOLD="${2:-}"
BASELINE="${RECETTE_BASELINE_SNAP:?RECETTE_BASELINE_SNAP manquant (snapshot main baseline)}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(dirname "$CAND_PROJ")"
CAND_SNAP="$WORK/candidate.snap.ndjson"

echo "== 1. snapshot d'appartenance du candidat =="
( cd "$REPO/api" && RECETTE_PG_NDJSON="$CAND_PROJ" RECETTE_SNAPSHOT_OUT="$CAND_SNAP" \
    npx vitest run src/services/graph/recette-membership-snapshot.prod.test.ts 2>&1 \
    | grep -E 'RECETTE_SNAPSHOT_TALLY|failed' | head -3 )

# Restreindre la baseline aux VILLES présentes dans le candidat : sinon les
# villes hors-lot (présentes dans la baseline complète, absentes du candidat)
# apparaîtraient à tort comme des SORTANTS. Le diff reste par id, mais borné
# aux city_slug du lot.
BASE_SUBSET="$WORK/baseline.subset.ndjson"
python3 - "$CAND_SNAP" "$BASELINE" "$BASE_SUBSET" <<'PY'
import sys, json
cand, base, out = sys.argv[1], sys.argv[2], sys.argv[3]
cities = set()
for l in open(cand):
    l = l.strip()
    if l:
        cities.add(json.loads(l).get("c"))
with open(out, "w") as o:
    for l in open(base):
        s = l.strip()
        if s and json.loads(s).get("c") in cities:
            o.write(s + "\n")
PY
echo "   baseline restreinte à $(wc -l < "$BASE_SUBSET") lignes (villes du lot)"

echo "== 2. bascules candidat vs baseline-du-lot (SORTANTS = hard-block) =="
rc=0
for axis in bprime precoce; do
  out="$(python3 "$REPO/scripts/recette/diff-snap.py" "$BASE_SUBSET" "$CAND_SNAP" "$axis")"
  echo "$out"
  sort="$(printf '%s\n' "$out" | grep -oE 'SORTANTS \(1->0\): [0-9]+' | grep -oE '[0-9]+$')"
  [ "${sort:-0}" != "0" ] && rc=1
done

if [ -n "$GOLD" ]; then
  echo "== 3. verdict par ville vs GOLD =="
  python3 "$REPO/scripts/recette/per-city-verdict.py" "$CAND_SNAP" "$GOLD" --axis bprime || rc=1
fi

echo "== VERDICT GATE : $([ $rc -eq 0 ] && echo 'PASS (zéro sortant)' || echo 'FAIL (sortants ou RED gold — revue recette requise)') =="
exit $rc
