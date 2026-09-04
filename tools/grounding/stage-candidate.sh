#!/usr/bin/env bash
# stage-candidate.sh — stage a host-grounded candidate to SCW docs-pocs candidats/<city>/ for the
# in-cluster publish-only Job to pull + hash-verify. Writes ONLY the candidats/ prefix (NEVER raw/,
# NEVER graph/ — the graph/ publish is the in-cluster Job → MinIO docs-preprod). The staged .sha256
# is the invariant recette certified and the Job hash-verifies (certify == published).
#
# Order (§7): host grounding → local candidate → recette certifies the local path+sha → THIS stage
# → in-cluster publish-only Job. Run this ONLY after recette's OK.
#
# Usage: stage-candidate.sh <city> <local_candidate.json>
# Env (docs-pocs RW): SCRAPE_S3_ENDPOINT SCRAPE_S3_BUCKET SCRAPE_S3_ACCESS_KEY SCRAPE_S3_SECRET_KEY
#      (sources ./.env if present). Optional EXPECTED_SHA to assert the staged bytes == what recette got.
set -euo pipefail
CITY="${1:?city requis}"
CAND="${2:?local candidate json requis}"
[ -s "$CAND" ] || { echo "stage-candidate: FAIL — candidat vide/absent: $CAND" >&2; exit 2; }
[ -f .env ] && { set -a; source .env; set +a; }
for v in SCRAPE_S3_ENDPOINT SCRAPE_S3_BUCKET SCRAPE_S3_ACCESS_KEY SCRAPE_S3_SECRET_KEY; do
  [ -z "${!v:-}" ] && { echo "stage-candidate: FAIL-CLOSED — $v vide (docs-pocs RW requis)." >&2; exit 2; }
done
export AWS_ACCESS_KEY_ID="$SCRAPE_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SCRAPE_S3_SECRET_KEY"
export AWS_REGION="${SCRAPE_S3_REGION:-us-east-1}"
S3="$SCRAPE_S3_ENDPOINT"; BUCKET="$SCRAPE_S3_BUCKET"

# prefix-safety : on écrit UNIQUEMENT candidats/ (jamais raw/proces-verbaux, jamais graph/).
PREFIX="candidats/$CITY"
case "$PREFIX/" in candidats/*/) : ;; *) echo "stage-candidate: FAIL-CLOSED — prefix hors candidats/ : $PREFIX" >&2; exit 2 ;; esac

SHA="$(sha256sum "$CAND" | awk '{print $1}')"
if [ -n "${EXPECTED_SHA:-}" ] && [ "$SHA" != "$EXPECTED_SHA" ]; then
  echo "stage-candidate: FAIL-CLOSED — sha local != EXPECTED_SHA ($SHA != $EXPECTED_SHA) : ce n'est pas l'artefact certifié." >&2; exit 2
fi
tmp_sha="$(mktemp)"; printf '%s  latest.json\n' "$SHA" > "$tmp_sha"
obj="s3://$BUCKET/$PREFIX/latest.json"
sha_obj="s3://$BUCKET/$PREFIX/latest.json.sha256"

s5cmd --endpoint-url "$S3" cp "$CAND" "$obj"
s5cmd --endpoint-url "$S3" cp "$tmp_sha" "$sha_obj"
rm -f "$tmp_sha"

# re-read verify : ce qui est staged == candidat local (intégrité bout-en-bout).
verify="$(mktemp)"
s5cmd --endpoint-url "$S3" cp "$obj" "$verify"
got="$(sha256sum "$verify" | awk '{print $1}')"; rm -f "$verify"
[ "$got" = "$SHA" ] || { echo "stage-candidate: FAIL — re-read staged sha != local ($got != $SHA)" >&2; exit 2; }

echo "stage-candidate[$CITY]: STAGED $obj (sha $SHA)"
echo "  sidecar $sha_obj"
echo "$SHA"
