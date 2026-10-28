#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
api=${1:?API evidence}; prefix=${2:?PWA-B-D evidence}; proxy=${3:?proxy evidence}
pwc=${4:?PWC evidence}; pwe=${5:?PWE evidence}; review=${6:?review evidence}
for directory in "$api" "$prefix" "$proxy" "$pwc" "$pwe" "$review"; do
  [[ $(realpath "$directory") == "$root/tmp/pwc-review-evidence/"* && ! -L $directory ]]
  source=$(cat "$directory/head.txt")
  [[ $source =~ ^[a-f0-9]{40}$ ]]
  git diff --quiet "$source" HEAD -- api packages package.json package-lock.json tsconfig.base.json \
    ui/nginx deploy/k8s/nginx deploy/overlays/preprod/nginx deploy/overlays/preprod/kustomization.yaml
done
before_intrusion() {
  [[ -s $2 ]]
  if [[ -f $1/occupancy-stop.txt ]]; then
    [[ $(stat -c %Y "$2") -lt $(stat -c %Y "$1/occupancy-stop.txt") ]]
  fi
}
command_passed() {
  awk -F '\t' -v label="$2" '$1==label {n++; if($2!=0) bad=1} END {exit !(n==1 && !bad)}' "$1/results.tsv"
}
vitest_passed() {
  before_intrusion "$1" "$1/$2.json"
  jq -e --argjson passed "$3" --argjson skipped "$4" \
    '.success and .numFailedTests==0 and .numFailedTestSuites==0 and .numPassedTests==$passed and .numPendingTests==$skipped' "$1/$2.json" >/dev/null
}
batch_passed() {
  before_intrusion "$1" "$1/$2-mutants/campaign.log"
  jq -e --arg batch "$2" 'any(.[]; .batch==$batch and .status==0 and .protectedBytesRestored)' "$1/inherited-mutants.json" >/dev/null
  jq -e --argjson count "$3" 'length==$count and ([.[].name]|unique|length)==$count' "$1/$2-mutants/mutations.json" >/dev/null
  actual=$(sha256sum "tools/make/base-api-$2-mutations.mjs" | cut -d' ' -f1)
  jq -e --arg batch "$2" --arg hash "$actual" 'any(.[]; .batch==$batch and .scriptSha256==$hash)' "$1/inherited-mutants.json" >/dev/null
}
for label in typecheck eslint app-result-regression required build full; do command_passed "$api" "$label"; done
vitest_passed "$api" required 369 0
vitest_passed "$api" full 4532 76
for label in typecheck eslint required results; do command_passed "$proxy" "$label"; done
vitest_passed "$proxy" required 3 0
batch_passed "$prefix" pwa 31
batch_passed "$prefix" pwb 5
batch_passed "$prefix" pwd 7
batch_passed "$pwc" pwc 25
for tuple in "$prefix/pwa" "$pwc/pwc"; do
  directory=${tuple%/*}; batch=${tuple##*/}
  jq -e 'all(.[]; .killed and .restored and (.sha256|test("^[a-f0-9]{64}$")))' "$directory/$batch-mutants/mutations.json" >/dev/null
done
jq -e 'all(.[]; .baseline.expected==.baseline.observed and .restored.expected==.restored.observed and .mutated.expected!=.mutated.observed)' "$prefix/pwb-mutants/mutations.json" >/dev/null
jq -e 'all(.[]; .baseline=="passed" and .mutated=="assertion_failed" and .restored=="passed")' "$prefix/pwd-mutants/mutations.json" >/dev/null
for tuple in "$pwe/pwe:52" "$review/pwcr:16"; do
  directory=${tuple%/*}; kind=${tuple##*/}; count=${kind##*:}; kind=${kind%:*}
  before_intrusion "$directory" "$directory/$kind-mutants.log"
  if [[ $kind == pwe ]]; then command_passed "$directory" pwe-mutants; else command_passed "$directory" review-mutants; fi
  jq -e --argjson count "$count" 'length==$count and ([.[].name]|unique|length)==$count and all(.[]; .killed and (.baseline|length)>0 and (.restored|length)>0 and all(.baseline[]; .status=="passed") and all(.restored[]; .status=="passed") and all(.mutated[]; .status=="passed" or .status=="failed") and any(.mutated[]; .status=="failed"))' "$directory/$kind-mutants/results.json" >/dev/null
done
jq -n --arg head "$(git rev-parse HEAD)" --arg apiSource "$(cat "$api/head.txt")" \
  --arg apiTree "$(git rev-parse HEAD:api)" --arg packagesTree "$(git rev-parse HEAD:packages)" \
  --arg api "$api" --arg prefix "$prefix" --arg proxy "$proxy" --arg pwc "$pwc" --arg pwe "$pwe" --arg review "$review" \
  '{qualified:true,head:$head,apiSource:$apiSource,apiTree:$apiTree,packagesTree:$packagesTree,
    required:{passed:369,failed:0,skipped:0},api:{passed:4532,failed:0,skipped:76},proxy:{passed:3,failed:0,skipped:0},
    mutations:{pwa:31,pwb:5,pwd:7,pwc:25,pwe:52,review:16,total:136},
    evidence:{api:$api,inheritedPrefix:$prefix,proxy:$proxy,pwc:$pwc,pwe:$pwe,review:$review}}' \
  > "$root/tmp/pwc-review-evidence/qualification.json"
cat "$root/tmp/pwc-review-evidence/qualification.json"
