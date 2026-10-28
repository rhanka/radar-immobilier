#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
base=26a78195ad17f8b80907074a91d6cb43ef6ac3dd
ref=refs/heads/feat/api-paniers-l5
head=$(git rev-parse HEAD)
directory=${FULL_EVIDENCE:?}
[[ $(git symbolic-ref HEAD) == "$ref" ]]
bash tools/make/base-api-l5-deliver.sh audit
git diff --check "$base" HEAD
check_source() {
  [[ $(realpath "$1") == "$root/tmp/l5-evidence/"* && ! -L $1 ]]
  [[ $(cat "$1/head.txt") == "$head" && $(cat "$1/status") == 0 ]]
  [[ ! -s $1/occupancy-stop.txt && ! -s $1/foreign-stack.txt ]]
  [[ -s $1/lock-release.txt && -s $1/cleanup.log ]]
}
command_passed() {
  awk -F '\t' -v label="$2" '$1==label {n++; if($2!=0) bad=1} END {exit !(n==1 && !bad)}' "$1/results.tsv"
}
before_intrusion() { [[ -s $2 && ! -s $1/occupancy-stop.txt && ! -s $1/foreign-stack.txt ]]; }
tests_passed() {
  jq -e '.success and .numFailedTests==0 and .numFailedTestSuites==0 and .numPassedTests>0' "$1/$2.json" >/dev/null
}
check_source "$directory"
for label in typecheck eslint ct8-staged app-result-regression required build full inherited-mutants pwe-mutants review-mutants l5-mutants results; do
  command_passed "$directory" "$label"
done
tests_passed "$directory" required
tests_passed "$directory" full
jq -e '.numPendingTests==0' "$directory/required.json" >/dev/null
expected=$(git ls-files -- 'api/src/artifacts/write-*.test.ts' \
  'api/src/services/facets/pw-write-*.test.ts' 'api/src/services/facets/signal-write-*.test.ts' \
  'api/tests/integration/pw-write*.spec.ts' 'api/tests/integration/pwe-*.spec.ts' 'api/tests/integration/pwcr-*.spec.ts' \
  'api/src/artifacts/published-write*.test.ts' 'api/tests/integration/l5-*.spec.ts' \
  'api/tests/integration/artifacts-baskets.spec.ts' 'api/tests/integration/artifacts-reader-opening.spec.ts' | sed 's#^api/##' | sort)
[[ $(tr ' ' '\n' < "$directory/scope.txt" | sed '/^$/d' | sort) == "$expected" ]]
while read -r file; do
  jq -e --arg suffix "/$file" '[.testResults[]|select(.name|endswith($suffix))|.assertionResults[]]|
    length>0 and all(.[];.status=="passed")' "$directory/required.json" >/dev/null
done <<< "$expected"
route_hash=$(sha256sum api/src/artifacts/write-intent-app-route.ts | cut -d' ' -f1)
jq -e --arg hash "$route_hash" '.postBytesUnchanged and .restoredSha256==$hash and .beforeSha256!=$hash and
  (.negative|length)==5 and (.positive|length)==5 and all(.positive[];.status=="passed") and
  all(.negative[];.status=="failed" and any(.failureMessages[];test("AssertionError") and contains("PW_E_APP_RECEIPT")))' \
  "$directory/app-result-regression.json" >/dev/null
mutants=$root/tmp/l5-evidence/mutations-r4.json
jq -n --arg directory "$directory" '{pwa:$directory,pwb:$directory,pwd:$directory,pwc:$directory,
  pwe:$directory,review:$directory,l5:$directory}' > "$mutants"
source tools/make/base-api-l5-proof-mutations.sh
jq -n --arg head "$head" --arg base "$base" --arg evidence "$directory" \
  --slurpfile required "$directory/required.json" --slurpfile full "$directory/full.json" \
  '{qualified:true,head:$head,base:$base,evidence:$evidence,
    required:{passed:$required[0].numPassedTests,failed:0,skipped:0},
    api:{passed:$full[0].numPassedTests,failed:0,skipped:$full[0].numPendingTests},
    witness:{negativeAssertions:5,restoredPassed:5,postBytesUnchanged:true},mutations:{total:139,failed:0},
    unverified:["Navigateur sur images produit r4","nginx non rejoué depuis r3","cas API conditionnels ignorés"]}' \
  > tmp/l5-evidence/qualification-r4.json
bundle=$root/tmp/l5-evidence/api-paniers-combined-r4.bundle
[[ ! -L $bundle ]]
git bundle create "$bundle" "$base..$ref"
target=$(mktemp -d "$root/tmp/l5-evidence/bundle-r4-audit.XXXXXX")
git init --bare -q "$target"
git -C "$target" fetch --no-tags --no-write-fetch-head "$root" "$base:refs/heads/prerequisite"
git -C "$target" symbolic-ref HEAD refs/heads/prerequisite
! git -C "$target" cat-file -e "$head^{commit}" 2>/dev/null
git -C "$target" bundle verify "$bundle"
git -C "$target" fetch --no-tags --no-write-fetch-head "$bundle" "$ref:$ref"
git -C "$target" symbolic-ref HEAD "$ref"
[[ $(git -C "$target" rev-parse HEAD) == "$head" ]]
[[ $(git -C "$target" rev-parse 'HEAD^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
git -C "$target" fsck --full --no-reflogs
printf 'BASE=%s\nHEAD=%s\nREF=%s\nAUDIT=%s\n' "$base" "$head" "$ref" "$target" | tee tmp/l5-evidence/bundle-r4-audit.txt
sha256sum "$bundle" | tee "$bundle.sha256"
