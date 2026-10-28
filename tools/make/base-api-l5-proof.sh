#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
api=${1:?API evidence}; mutants=${2:?mutation evidence}
proxy=${3:?nginx evidence}; images=${4:?image evidence}
for directory in "$api" "$mutants" "$proxy" "$images"; do
  [[ $(realpath "$directory") == "$root/tmp/l5-evidence/"* && ! -L $directory ]]
  source=$(cat "$directory/head.txt")
  [[ $source =~ ^[a-f0-9]{40}$ ]]
  git diff --quiet "$source" HEAD -- api packages package.json package-lock.json tsconfig.base.json \
    ui/nginx deploy/k8s/nginx deploy/overlays/preprod/nginx deploy/overlays/preprod/kustomization.yaml
done
before_intrusion() {
  [[ -s $2 ]]
  for marker in occupancy-stop.txt foreign-stack.txt; do
    if [[ -f $1/$marker ]]; then [[ $(stat -c %Y "$2") -lt $(stat -c %Y "$1/$marker") ]]; fi
  done
}
command_passed() {
  awk -F '\t' -v label="$2" '$1==label {n++; if($2!=0) bad=1} END {exit !(n==1 && !bad)}' "$1/results.tsv"
}
tests_passed() {
  before_intrusion "$1" "$1/$2.json"
  jq -e '.success and .numFailedTests==0 and .numFailedTestSuites==0 and .numPassedTests>0' "$1/$2.json" >/dev/null
}
for label in typecheck eslint ct8-staged app-result-regression required build full; do command_passed "$api" "$label"; done
tests_passed "$api" required; tests_passed "$api" full
jq -e '.numPendingTests==0' "$api/required.json" >/dev/null
expected=$(git ls-files -- 'api/src/artifacts/write-*.test.ts' \
  'api/src/services/facets/pw-write-*.test.ts' 'api/src/services/facets/signal-write-*.test.ts' \
  'api/tests/integration/pw-write*.spec.ts' 'api/tests/integration/pwe-*.spec.ts' 'api/tests/integration/pwcr-*.spec.ts' \
  'api/src/artifacts/published-write*.test.ts' 'api/tests/integration/l5-*.spec.ts' \
  'api/tests/integration/artifacts-baskets.spec.ts' 'api/tests/integration/artifacts-reader-opening.spec.ts' | sed 's#^api/##' | sort)
[[ $(tr ' ' '\n' < "$api/scope.txt" | sed '/^$/d' | sort) == "$expected" ]]
while read -r file; do
  jq -e --arg file "/$file" '[.testResults[]|select(.name|endswith($file))|.assertionResults[]]|
    length>0 and all(.[];.status=="passed")' "$api/required.json" >/dev/null
done <<< "$expected"
count=$(jq '.entries|length' api/drizzle/meta/_journal.json)
for kind in fresh upgrade; do rg -Fx "CT8 PASS $kind + rerun: $count hashes exactly once" "$api/ct8.log" >/dev/null; done
before_intrusion "$api" "$api/ct8-staged.json"
jq -e --argjson count "$count" '.receipts|length==3 and .[-1].count==$count and all(.[];.retained and .rerun)' "$api/ct8-staged.json" >/dev/null
for label in typecheck eslint required results; do command_passed "$proxy" "$label"; done
tests_passed "$proxy" required
jq -e '.numPassedTests==3 and .numPendingTests==0' "$proxy/required.json" >/dev/null
[[ $(cat "$proxy/status") == 0 && -s $proxy/lock-release.txt ]]
source tools/make/base-api-l5-proof-mutations.sh
source tools/make/base-api-l5-proof-images.sh
jq -n --arg head "$(git rev-parse HEAD)" --arg api "$api" --arg mutants "$mutants" --arg proxy "$proxy" --arg images "$images" \
  --arg imageId "$(cat "$images/image-id.txt")" --slurpfile required "$api/required.json" --slurpfile full "$api/full.json" \
  '{qualified:true,head:$head,imageId:$imageId,required:{passed:$required[0].numPassedTests,failed:0,skipped:0},
    api:{passed:$full[0].numPassedTests,failed:0,skipped:$full[0].numPendingTests},proxy:{passed:3,failed:0,skipped:0},
    browser:{passed:10,failed:0,skipped:0},mutations:{pwa:31,pwb:5,pwd:7,pwc:25,pwe:52,review:16,l5:3,total:139},
    evidence:{api:$api,mutations:$mutants,proxy:$proxy,images:$images}}' > tmp/l5-evidence/qualification.json
cat tmp/l5-evidence/qualification.json
