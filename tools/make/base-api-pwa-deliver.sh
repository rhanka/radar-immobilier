#!/usr/bin/env bash
# Local subject-only commits and an independently reconstructed incremental bundle.
set -euo pipefail
[[ $ENV == test-api-paniers-pwa && $API_PORT == 18933 && $UI_PORT == 15933 && $MAILDEV_UI_PORT == 11933 ]]
ROOT=$(pwd -P)
BASE=de81ef0ef30dd1ca0bf575498e342be525f5cc2d
START=39ed4f1b94d1e9ec9c8bf0213baf1fa6aadcadb6
PLAN=plan/PWA-BRANCH_feat-api-paniers-pwa.md
runner=(make --no-print-directory -f tools/make/base-api-pwa.mk)
args=("API_PORT=$API_PORT" "UI_PORT=$UI_PORT" "MAILDEV_UI_PORT=$MAILDEV_UI_PORT" "ENV=$ENV")
[[ $(git branch --show-current) == feat/api-paniers-pwa ]]
git diff --cached --quiet
if [[ ${1:-all} != commit-slices ]]; then
  evidence=$(cat tmp/pwa-evidence/latest)
  [[ -f $evidence/result && $(cat "$evidence/status") == 0 ]]
  sha256sum --check --quiet "$evidence/files.sha256"
  full=$(cat tmp/pwa-evidence/latest-full)
  for report in ci-tests artifacts-host-tests scoped-tests; do
    jq -e '.success and .numFailedTests == 0 and .numPassedTests > 0' "$full/$report.json" >/dev/null
  done
  jq -e '.numPendingTests == 0' "$full/scoped-tests.json" >/dev/null
  jq -e 'length == 7 and all(.killed and .restored)' "$full/mutations.json" >/dev/null
  if [[ $(cat "$evidence/mode.txt") == mcp ]]; then
    jq -e '.success and .numFailedTests == 0 and .numPassedTests > 0' "$evidence/immo-mcp-tests.json" >/dev/null
  fi
  # MCP-only runner repairs change tooling; every application/test/package byte
  # must still match the successful API, static, mutation and ARTEFACTS campaign.
  awk '$2 !~ /^tools\/make\/base-api-pwa/ {print}' "$full/files.sha256" \
    | sha256sum --check --quiet
fi
commit_file() {
  local file=$1 type=feat label
  case $file in *.test.ts|*.spec.ts|*fixture.ts) type=test;; tools/*) type=chore;; plan/*) type=docs;; esac
  label=${file##*/}
  label=${label%.ts}; label=${label%.sh}; label=${label%.mjs}; label=${label%.mk}
  label=${label#write-}; label=${label#base-api-pwa-}
  label=${label#pw-write-authority-}
  MSG="$type(pw-a): add $label"
  if [[ $file == "$PLAN" ]]; then MSG='docs(pw-a): declare qualification scope';
  else printf '\n- [x] Delivery: `%s`.\n' "$file" >> "$PLAN"; fi
  "${runner[@]}" pwa-stage "FILES=$file $PLAN" "${args[@]}"
  "${runner[@]}" pwa-commit "MSG=$MSG" "${args[@]}"
}
if ! git ls-files --error-unmatch "$PLAN" >/dev/null 2>&1; then commit_file "$PLAN"; fi
mapfile -t files < <(git ls-files --modified --others --exclude-standard -- \
  'api/src/artifacts/write-*' 'api/tests/integration/pw-write-authority*' \
  api/tests/integration/pw-write-createapp.spec.ts 'tools/make/base-api-pwa*' api/src/app.ts api/src/config.ts | sort -u)
for file in "${files[@]}"; do commit_file "$file"; done
if ! git diff --quiet -- "$PLAN"; then
  "${runner[@]}" pwa-stage "FILES=$PLAN" "${args[@]}"
  "${runner[@]}" pwa-commit 'MSG=docs(pw-a): record qualification progress' "${args[@]}"
fi
[[ ${1:-all} != commit-slices ]] || exit 0
git diff --quiet
git diff --cached --quiet
while IFS= read -r commit; do
  message=$(git show -s --format=%B "$commit")
  [[ $message != *$'\n'* && $message =~ ^(feat|fix|test|docs|chore)\(pw-a\):\ .+$ ]]
  git show --format= --numstat "$commit" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
  git show -s --format='%H %s' "$commit"
done < <(git rev-list --reverse "$START..HEAD")
for merge in 512ca686 39ed4f1b; do git merge-base --is-ancestor "$merge" HEAD; done
[[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 8388608 ]]
head=$(git rev-parse HEAD)
tree=$(git rev-parse 'HEAD^{tree}')
out=$ROOT/tmp/pwa-evidence/api-paniers-pwa.bundle
git bundle create "$out" "$BASE..HEAD"
git bundle verify "$out"
audit=$(mktemp -d "$ROOT/tmp/pwa-evidence/bundle-audit.XXXXXX")
git init --bare -q "$audit"
git -C "$audit" fetch --no-tags --no-write-fetch-head "$ROOT" "$BASE:refs/heads/base"
if git -C "$audit" cat-file -e "$head^{commit}" 2>/dev/null; then echo 'Payload present before import' >&2; exit 2; fi
git -C "$audit" bundle verify "$out"
git -C "$audit" fetch --no-tags --no-write-fetch-head "$out" HEAD:refs/heads/payload
[[ $(git -C "$audit" rev-parse payload) == "$head" && $(git -C "$audit" rev-parse 'payload^{tree}') == "$tree" ]]
for merge in 512ca686 39ed4f1b; do git -C "$audit" merge-base --is-ancestor "$merge" payload; done
git -C "$audit" fsck --full --no-reflogs
sha256sum "$out" | tee tmp/pwa-evidence/bundle.sha256
printf 'HEAD=%s\nTREE=%s\nAUDIT=%s\n' "$head" "$tree" "$audit" | tee tmp/pwa-evidence/delivery.txt
