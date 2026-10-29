#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
base=26a78195ad17f8b80907074a91d6cb43ef6ac3dd
ref=refs/heads/feat/api-paniers-l5
head=$(git rev-parse HEAD)
required=${REQUIRED_EVIDENCE:?}
proxy=${PROXY_EVIDENCE:?}
[[ $(git symbolic-ref HEAD) == "$ref" ]]
bash tools/make/base-api-l5-deliver.sh audit
git diff --check "$base" HEAD
check_source() {
  [[ $(realpath "$1") == "$root/tmp/l5-evidence/"* && ! -L $1 ]]
  [[ ! -s $1/occupancy-stop.txt && ! -s $1/foreign-stack.txt ]]
  [[ $(cat "$1/status") == 0 && -s $1/lock-release.txt && -s $1/cleanup.log ]]
  git diff --quiet "$(cat "$1/head.txt")" HEAD -- api packages package.json package-lock.json tsconfig.base.json \
    'tools/make/base-api-pwe*.mjs' tools/make/base-api-l5-container.sh 'tools/make/base-api-l5-pwe*.mjs'
}
check_tests() {
  local directory=$1 label
  check_source "$directory"
  for label in typecheck eslint ct8-staged required results; do
    awk -F '\t' -v label="$label" '$1==label {n++; if($2!=0) bad=1} END {exit !(n==1 && !bad)}' "$directory/results.tsv"
  done
  jq -e '.success and .numFailedTests==0 and .numFailedTestSuites==0 and .numPendingTests==0 and .numPassedTests>0' \
    "$directory/required.json" >/dev/null
}
check_tests "$required"
check_tests "$proxy"
expected=$(git ls-files -- 'api/src/artifacts/write-*.test.ts' \
  'api/src/services/facets/pw-write-*.test.ts' 'api/src/services/facets/signal-write-*.test.ts' \
  'api/tests/integration/pw-write*.spec.ts' 'api/tests/integration/pwe-*.spec.ts' 'api/tests/integration/pwcr-*.spec.ts' \
  'api/src/artifacts/published-write*.test.ts' 'api/tests/integration/l5-*.spec.ts' \
  'api/tests/integration/artifacts-baskets.spec.ts' 'api/tests/integration/artifacts-reader-opening.spec.ts' | sed 's#^api/##' | sort)
[[ $(tr ' ' '\n' < "$required/scope.txt" | sed '/^$/d' | sort) == "$expected" ]]
while read -r file; do
  jq -e --arg suffix "/$file" '[.testResults[]|select(.name|endswith($suffix))|.assertionResults[]]|
    length>0 and all(.[];.status=="passed")' "$required/required.json" >/dev/null
done <<< "$expected"
[[ $(cat "$proxy/scope.txt") == tests/integration/pwcr-proxy.acceptance.ts ]]
jq -e '.numPassedTests==3 and ([.testResults[].assertionResults[].fullName] as $names |
  all(["compose","cluster","preprod"][]; . as $variant | any($names[]; contains($variant))))' \
  "$proxy/required.json" >/dev/null
awk -F '\t' '$1=="pwe-mutants" {n++; if($2!=0) bad=1} END {exit !(n==1 && !bad)}' "$required/results.tsv"
jq -e 'length==52 and ([.[].name]|unique|length)==52 and
  any(.[];.name=="M11-replayed-executor") and all(.[];
    .killed==true and (has("error")|not) and (.baseline|length)>0 and (.restored|length)>0 and
    all(.baseline[];.status=="passed") and all(.restored[];.status=="passed") and
    any(.mutated[];.status=="failed" and any(.failureMessages[];test("AssertionError|__VITEST_REJECTS__"))))' \
  "$required/pwe-mutants/results.json" >/dev/null
jq -e '.status==0 and .signal==null and (.caseNames|length)==52' "$required/l5-pwe-harness.json" >/dev/null
jq -n --arg head "$head" --arg base "$base" --arg required "$required" --arg proxy "$proxy" \
  --argjson passed "$(jq '.numPassedTests' "$required/required.json")" \
  '{qualified:true,head:$head,base:$base,required:{passed:$passed,failed:0,skipped:0,evidence:$required},
    proxy:{passed:3,failed:0,skipped:0,evidence:$proxy},mutations:{killed:52,failed:0,skipped:0,evidence:$required},
    unverified:["API globale sur r3","navigateur sur images r3","autres groupes de mutations sur r3"],
    scope:"Troisième passe #938 : quatre points demandés, matrices PW requises et campagne PWE complète"}' \
  > tmp/l5-evidence/qualification-r3.json
bundle=$root/tmp/l5-evidence/api-paniers-combined-r3.bundle
[[ ! -L $bundle ]]
git bundle create "$bundle" "$base..$ref"
target=$(mktemp -d "$root/tmp/l5-evidence/bundle-r3-audit.XXXXXX")
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
printf 'BASE=%s\nHEAD=%s\nREF=%s\nAUDIT=%s\n' "$base" "$head" "$ref" "$target" | tee tmp/l5-evidence/bundle-r3-audit.txt
sha256sum "$bundle" | tee "$bundle.sha256"
