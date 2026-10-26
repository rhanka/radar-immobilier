#!/usr/bin/env bash
# Local subject-only commits and an independently reconstructed incremental bundle.
set -euo pipefail
[[ $ENV == test-api-paniers-pwa && $API_PORT == 18933 && $UI_PORT == 15933 && $MAILDEV_UI_PORT == 11933 ]]
ROOT=$(pwd -P)
BASE=07ef2757a80c168938e888f52c6925c9f8138016
START=$BASE
PLAN=plan/PWA-BRANCH_feat-api-paniers-pwa.md
runner=(make --no-print-directory -f tools/make/base-api-pwa.mk)
args=("API_PORT=$API_PORT" "UI_PORT=$UI_PORT" "MAILDEV_UI_PORT=$MAILDEV_UI_PORT" "ENV=$ENV")
[[ $(git branch --show-current) == feat/api-paniers-pwa ]]
git diff --cached --quiet
if [[ ${1:-all} != commit-slices ]]; then
  evidence=$(cat tmp/pwa-evidence/latest)
  [[ -f $evidence/result && $(cat "$evidence/status") == 0 ]]
  # Delivery tooling is audited below; all campaign inputs remain byte-pinned.
  awk '$2 != "tools/make/base-api-pwa-deliver.sh" {print}' "$evidence/files.sha256" \
    | sha256sum --check --quiet
  full=$(cat tmp/pwa-evidence/latest-full)
  for report in ci-tests artifacts-host-tests scoped-tests; do
    jq -e '.success and .numFailedTests == 0 and .numPassedTests > 0' "$full/$report.json" >/dev/null
  done
  jq -e '.numPendingTests == 0' "$full/scoped-tests.json" >/dev/null
  jq -e 'length == 30 and all(.killed and .restored)' "$full/mutations.json" >/dev/null
  jq -e '.numPendingTests == 76' "$full/ci-tests.json" >/dev/null
  [[ $(cat "$full/status") == 0 ]]
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
  [[ $message != *$'\n'* && $message =~ ^(feat|fix|test|docs|chore)\(pw-[ad]\):\ .+$ ]]
  git show --format= --numstat "$commit" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
  git show -s --format='%H %s' "$commit"
done < <(git rev-list --reverse --no-merges "$START..HEAD")
for merge in 512ca686 39ed4f1b 0ab7d664; do git merge-base --is-ancestor "$merge" HEAD; done
mapfile -t merges < <(git rev-list --first-parent --merges "$BASE..HEAD")
[[ ${#merges[@]} == 0 ]]
git merge-base --is-ancestor 4c3959b6 HEAD
[[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 8388608 ]]
head=$(git rev-parse HEAD)
tree=$(git rev-parse 'HEAD^{tree}')
out=$ROOT/tmp/pwa-evidence/api-paniers-pwa-fix3.bundle
git bundle create "$out" "$BASE..HEAD"
git bundle verify "$out"
audit=$(mktemp -d "$ROOT/tmp/pwa-evidence/bundle-fix3-audit.XXXXXX")
audit_git() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git -C "$audit" "$@"; }
env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git init --bare -q "$audit"
audit_git fetch --no-tags --no-write-fetch-head "$ROOT" "$BASE:refs/heads/base"
if audit_git cat-file -e "$head^{commit}" 2>/dev/null; then echo 'Payload present before import' >&2; exit 2; fi
audit_git bundle verify "$out"
audit_git fetch --no-tags --no-write-fetch-head "$out" HEAD:refs/heads/payload
audit_git symbolic-ref HEAD refs/heads/payload
[[ $(audit_git rev-parse HEAD) == "$head" && $(audit_git rev-parse 'HEAD^{tree}') == "$tree" ]]
for merge in 512ca686 39ed4f1b 0ab7d664; do audit_git merge-base --is-ancestor "$merge" payload; done
audit_git fsck --full --no-reflogs
sha256sum "$out" | tee tmp/pwa-evidence/bundle-fix3.sha256
printf 'HEAD=%s\nTREE=%s\nAUDIT=%s\n' "$head" "$tree" "$audit" | tee tmp/pwa-evidence/delivery-fix3.txt
