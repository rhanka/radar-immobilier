#!/usr/bin/env bash
set -euo pipefail
BASE=de81ef0ef30dd1ca0bf575498e342be525f5cc2d
[[ ${ENV:-} == test-api-paniers-pwd ]]
[[ $(git branch --show-current) == feat/api-paniers-pwd ]]
git diff --exit-code
git diff --cached --exit-code
[[ -z $(git ls-files --others --exclude-standard) ]]
git merge-base --is-ancestor "$BASE" HEAD
root=$(pwd -P)
head=$(git rev-parse HEAD)
out=$root/tmp/pwd-evidence/corrections/delivery
mkdir -p "$out"
git diff --exit-code "$BASE" HEAD -- api/drizzle ':!api/drizzle/0025_pw_write_persistence.sql'
campaign=$(cat tmp/pwd-evidence/latest)
[[ $(cat "$campaign/status") == 0 && -f $campaign/result && ! -f $campaign/repro-source.tar ]]
mkdir -p "$out/tested-sources"
tar -xf tmp/pwd-evidence/runtime/source.tar -C "$out/tested-sources"
while IFS= read -r path; do
  cmp -- "$path" "$out/tested-sources/$path"
done < <(sort -u "$campaign/archived-paths.txt")
: > "$out/commits.tsv"
while IFS= read -r sha; do
  subject=$(git show -s --format=%s "$sha")
  [[ $(git show -s --format=%B "$sha") == "$subject" ]]
  [[ $subject =~ ^(fix|test|docs|chore)\(pw-d\):\  ]]
  read -r files lines < <(git show --format= --numstat "$sha" | awk '{f++;n+=$1+$2} END {print f,n}')
  [[ $files -ge 1 && $files -le 15 && $lines -le 150 ]]
  while IFS= read -r path; do
    case $path in
      api/src/services/facets/pw-write*|api/src/db/schema-pw-write.ts|api/drizzle/0025_pw_write_persistence.sql|\
      docs/spec/PW_D_PERSISTENCE.md|plan/PWD-BRANCH_feat-api-paniers-pwd.md|tools/make/base-api-pwd*) ;;
      *) echo "Outside PW-D corrections: $path"; exit 2;;
    esac
  done < <(git diff-tree --no-commit-id --name-only -r "$sha")
  printf '%s\t%s\t%s\t%s\n' "$sha" "$files" "$lines" "$subject" >> "$out/commits.tsv"
done < <(git rev-list --reverse "$BASE..HEAD")
git diff --check "$BASE" HEAD
git bundle create "$out/api-paniers-pwd-astra-fixes.bundle" "$BASE..HEAD"
git bundle verify "$out/api-paniers-pwd-astra-fixes.bundle" > "$out/bundle-verify.log" 2>&1
git -C tmp/pwd-evidence/rescue.git fetch --no-tags "$root" HEAD:refs/heads/astra-delivery
audit=$(mktemp -d "$out/audit.XXXXXX")
git init --bare -q "$audit"
git -C "$audit" fetch --no-tags --no-write-fetch-head \
  "$root/tmp/pwd-evidence/corrections/base.bundle" HEAD:refs/heads/base
[[ $(git -C "$audit" rev-parse refs/heads/base) == "$BASE" ]]
if git -C "$audit" cat-file -e "$head^{commit}" 2>/dev/null; then
  echo 'Delivery objects present before bundle import'; exit 2
fi
git -C "$audit" bundle verify "$out/api-paniers-pwd-astra-fixes.bundle" > "$out/isolated-verify.log" 2>&1
git -C "$audit" fetch --no-tags --no-write-fetch-head \
  "$out/api-paniers-pwd-astra-fixes.bundle" HEAD:refs/heads/delivery
[[ $(git -C "$audit" rev-parse refs/heads/delivery) == "$head" ]]
[[ $(git -C "$audit" rev-parse 'refs/heads/delivery^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
git -C "$audit" fsck --full --no-reflogs > "$out/isolated-fsck.log" 2>&1
printf 'base=%s\nhead=%s\ntree=%s\naudit=%s\ncampaign=%s\n' \
  "$BASE" "$head" "$(git rev-parse 'HEAD^{tree}')" "$audit" "$campaign" | tee "$out/identity.txt"
sha256sum "$out/api-paniers-pwd-astra-fixes.bundle" | tee "$out/bundle.sha256"
