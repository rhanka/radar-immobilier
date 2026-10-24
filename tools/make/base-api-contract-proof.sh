#!/usr/bin/env bash
# Read only the explicitly authorized contract sources, never client materials.
set -euo pipefail
source_file=/home/antoinefa/src/radar-immobilier/.lanes/conductor/tmp/861c/execution-artefacts-v2.md
mkdir -p tmp/base-api-evidence/B0/contract
dir=$PWD/tmp/base-api-evidence/B0/contract
rg '^- \[ \] CT-[1-9] —' "$source_file" > "$dir/expected"
[[ $(wc -l < "$dir/expected") == 9 ]]
spec=docs/spec/SPEC_BASE_API.md
[[ -f $spec ]] || spec=docs/spec/SPEC_EVOL_BASE_API.md
for file in plan/BASEAPI-BRANCH_feat_base-api-decouplee.md "$spec"; do
  sed -E 's/^- CT-/- [ ] CT-/' "$file" | rg '^- \[ \] CT-[1-9] —' > "$dir/actual"
  cmp "$dir/expected" "$dir/actual"
  echo "PASS byte-identical CT-1..CT-9: $file"
done
sha256sum "$dir/expected" > "$dir/ct.sha256"
pin=3c6d3c1f95d6794ba0939cf71db6b169cb3f071d
for tag in 0022_facet_lot_cutover 0023_facet_lot_versions_fence; do
  git show "$pin:api/drizzle/$tag.sql" | sha256sum > "$dir/$tag.sha256"
done
git show "$pin:api/drizzle/meta/_journal.json" > "$dir/pinned-journal.json"
echo 'PASS pinned SQL reservations captured; applied/released state requires an operator receipt'
