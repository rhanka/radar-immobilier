#!/bin/bash
# I-1A recount (converged r3 P2) — READ-ONLY probe of the public prod OGC API.
#
# Fetches the live `/collections` listing ONCE and prints:
#   1. the eligible count (qc-zonage-* with a known licence title AND rights),
#   2. the distinct licence titles observed (registry uniqueness input),
#   3. the eligible collection ids (pilot-city choice input),
#   4. the business-pilot gap status (Salaberry-de-Valleyfield).
#
# No mutation, no credential, no pagination beyond the single listing call.
# Requires: curl, jq.
set -euo pipefail

BASE="${GEO_OGC_BASE_URL:-https://api.geo.sent-tech.ca}"
KNOWN_TITLE="Creative Commons Attribution 4.0 International"

listing="$(curl -s --max-time 60 "${BASE}/collections?f=json&limit=10000")"
total="$(printf '%s' "$listing" | jq '.collections | length')"

echo "== I-1A recount (P2) =="
echo "source: ${BASE}/collections (live, read-only)"
echo "total collections: ${total}"
echo ""
echo "-- families x licence title --"
printf '%s' "$listing" | jq -r '.collections[] | [.id, (.license.title // "«no-title»")] | @tsv' | awk -F'\t' '{
  id=$1;
  if (id ~ /^qc-zoning-events-/) fam="qc-zoning-events-*";
  else if (id ~ /^qc-zonage-norms-/) fam="qc-zonage-norms-*";
  else if (id ~ /^qc-zonage-/) fam="qc-zonage-*";
  else if (id ~ /^qc-lots-/) fam="qc-lots-*";
  else if (id ~ /^qc-tod-/) fam="qc-tod-*";
  else fam="other";
  print fam"\t"$2
}' | sort | uniq -c | sort -rn
echo ""
echo "-- distinct licence titles (registry uniqueness input) --"
printf '%s' "$listing" | jq -r '.collections[] | (.license.title // "«no-title»")' | sort -u
echo ""
echo "-- eligible (qc-zonage-*, known CC-BY-4.0 title, rights present): count --"
eligible="$(printf '%s' "$listing" | jq -r --arg t "$KNOWN_TITLE" \
  '[.collections[] | select(.id | startswith("qc-zonage-"))
    | select(.license.title == $t) | select(.rights != null)] | length')"
echo "eligible count: ${eligible}"
echo ""
echo "-- eligible collection ids --"
printf '%s' "$listing" | jq -r --arg t "$KNOWN_TITLE" \
  '.collections[] | select(.id | startswith("qc-zonage-"))
   | select(.license.title == $t) | select(.rights != null) | .id' | sort
echo ""
echo "-- business-pilot gap --"
printf '%s' "$listing" | jq -r \
  '.collections[] | select(.id == "qc-zonage-salaberry-de-valleyfield")
   | "\(.id): \(.license.title // "«no-title»"), rights=\(.rights != null)"'
