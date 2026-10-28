#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
base=26a78195ad17f8b80907074a91d6cb43ef6ac3dd
ref=refs/heads/feat/api-paniers-l5
head=$(git rev-parse HEAD)
required=${REQUIRED_EVIDENCE:?}
reader=${READER_EVIDENCE:?}
images=${IMAGE_EVIDENCE:?}
[[ $(git symbolic-ref HEAD) == "$ref" ]]
bash tools/make/base-api-l5-deliver.sh audit
git diff --check "$base" HEAD
check_source() {
  [[ $(realpath "$1") == "$root/tmp/l5-evidence/"* && ! -L $1 ]]
  [[ ! -s $1/occupancy-stop.txt && ! -s $1/foreign-stack.txt ]]
  [[ $(cat "$1/status") == 0 && -s $1/lock-release.txt ]]
  git diff --quiet "$(cat "$1/head.txt")" HEAD -- api packages package.json package-lock.json tsconfig.base.json
}
check_tests() {
  local directory=$1 label
  check_source "$directory"
  for label in typecheck eslint ct8-staged required results; do
    awk -F '\t' -v label="$label" '$1==label {n++; if($2!=0) bad=1} END {exit !(n==1 && !bad)}' "$directory/results.tsv"
  done
  jq -e '.success and .numFailedTests==0 and .numFailedTestSuites==0 and .numPendingTests==0 and .numPassedTests>0' \
    "$directory/required.json" >/dev/null
  while read -r file; do
    jq -e --arg suffix "/$file" '[.testResults[]|select(.name|endswith($suffix))|.assertionResults[]]|
      length>0 and all(.[];.status=="passed")' "$directory/required.json" >/dev/null
  done < <(tr ' ' '\n' < "$directory/scope.txt" | sed '/^$/d')
  [[ -s $directory/cleanup.log ]]
}
check_tests "$required"
check_tests "$reader"
expected=$(git ls-files -- 'api/src/artifacts/write-*.test.ts' \
  'api/src/services/facets/pw-write-*.test.ts' 'api/src/services/facets/signal-write-*.test.ts' \
  'api/tests/integration/pw-write*.spec.ts' 'api/tests/integration/pwe-*.spec.ts' 'api/tests/integration/pwcr-*.spec.ts' \
  'api/src/artifacts/published-write*.test.ts' 'api/tests/integration/l5-*.spec.ts' \
  'api/tests/integration/artifacts-baskets.spec.ts' 'api/tests/integration/artifacts-reader-opening.spec.ts' | sed 's#^api/##' | sort)
[[ $(tr ' ' '\n' < "$required/scope.txt" | sed '/^$/d' | sort) == "$expected" ]]
check_source "$images"
[[ $(cat "$images/head.txt") == "$head" && -s $images/final-cleanup.log ]]
image=$(cat "$images/image-id.txt")
for host in pages.sent-tech.ca pages.reader.test; do
  count=12; [[ $host != pages.sent-tech.ca ]] || count=15
  directory=$images/$host
  jq -e --argjson count "$count" '.success and .numPassedTests==$count and .numFailedTests==0 and
    .numFailedTestSuites==0 and .numPendingTests==0' "$directory/browser.json" >/dev/null
  for service in runtime runtime-base runtime-read; do
    [[ $(cat "$directory/$service-image-id.txt") == "$image" ]]
    [[ $(cat "$directory/$service-release-sha.txt") == "$head" ]]
  done
  for proof in expired-gesture expired-confirmation app-deadline-transport app-deadline-body \
    bootstrap-deadline-transport bootstrap-deadline-body status-withdrawal; do
    jq -e --arg head "$head" '.imageSha==$head' "$directory/browser-$proof.json" >/dev/null
  done
  [[ -s $directory/cleanup.log && -s $directory/image-database-migrations.json ]]
done
jq -n --arg head "$head" --arg base "$base" --arg image "$image" --arg required "$required" \
  --arg reader "$reader" --arg images "$images" \
  --argjson requiredPassed "$(jq '.numPassedTests' "$required/required.json")" \
  --argjson readerPassed "$(jq '.numPassedTests' "$reader/required.json")" \
  '{qualified:true,head:$head,base:$base,image:$image,required:{passed:$requiredPassed,skipped:0,evidence:$required},
    reader:{passed:$readerPassed,skipped:0,evidence:$reader},browser:{passed:27,skipped:0,imagePassed:24,legacyReadPassed:3,evidence:$images},
    scope:"PR 938 second-pass fixes, touched reader suites and required PW matrices; historical full API and mutations not replayed"}' \
  > tmp/l5-evidence/qualification-r2.json
bundle=$root/tmp/l5-evidence/api-paniers-combined-r2.bundle
[[ ! -L $bundle ]]
git bundle create "$bundle" "$base..$ref"
target=$(mktemp -d "$root/tmp/l5-evidence/bundle-r2-audit.XXXXXX")
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
printf 'BASE=%s\nHEAD=%s\nREF=%s\nAUDIT=%s\n' "$base" "$head" "$ref" "$target" | tee tmp/l5-evidence/bundle-r2-audit.txt
sha256sum "$bundle" | tee "$bundle.sha256"
