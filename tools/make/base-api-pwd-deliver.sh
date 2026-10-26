#!/usr/bin/env bash
set -euo pipefail
BASE=b09a8ccc
[[ ${ENV:-} == test-api-paniers-pwd ]]
[[ $(git branch --show-current) == feat/api-paniers-pwd ]]
git diff --exit-code
git diff --cached --exit-code
[[ -z $(git ls-files --others --exclude-standard) ]]
root=$(pwd -P)
head=$(git rev-parse HEAD)
out=$root/tmp/pwd-evidence/delivery
mkdir -p "$out"
merge=$(git rev-list --first-parent --merges -1 "$BASE..HEAD")
[[ -n $merge && $(git rev-parse "$merge^1") == $(git rev-parse "$BASE") ]]
git merge-base --is-ancestor origin/feat/artefacts-mcp-a5 "$merge"
git diff --exit-code origin/feat/artefacts-mcp-a5 HEAD -- api/drizzle \
  ':!api/drizzle/0025_pw_write_persistence.sql' ':!api/drizzle/meta/_journal.json'
: > "$out/commits.tsv"
while IFS= read -r sha; do
  subject=$(git show -s --format=%s "$sha")
  [[ $(git show -s --format=%B "$sha") == "$subject" ]]
  [[ $subject =~ ^(feat|fix|test|docs|chore)\(pw-d\):\  ]]
  read -r files lines < <(git show --format= --numstat "$sha" | awk '{f++;n+=$1+$2} END {print f,n}')
  [[ $files -ge 1 && $files -le 15 && $lines -le 150 ]]
  while IFS= read -r path; do
    case $path in
      api/src/services/facets/pw-write*|api/src/db/schema-pw-write.ts|api/src/db/schema.ts|\
      api/drizzle/0025_pw_write_persistence.sql|api/drizzle/meta/_journal.json|\
      api/tests/integration/pw-write*|api/tests/integration/artifacts-finalization-authorization.spec.ts|\
      docs/spec/PW_D_PERSISTENCE.md|plan/PWD-BRANCH_feat-api-paniers-pwd.md|tools/make/base-api-pwd*) ;;
      *) echo "Outside PW-D scope: $path"; exit 2;;
    esac
  done < <(git diff-tree --no-commit-id --name-only -r "$sha")
  printf '%s\t%s\t%s\t%s\n' "$sha" "$files" "$lines" "$subject" >> "$out/commits.tsv"
done < <(git rev-list --reverse --first-parent --no-merges "$merge..HEAD")
git diff --check "$BASE" HEAD
git bundle create "$out/api-paniers-pwd.bundle" "$BASE..HEAD"
git bundle verify "$out/api-paniers-pwd.bundle" > "$out/bundle-verify.log" 2>&1
git -C tmp/pwd-evidence/rescue.git fetch --no-tags "$root" HEAD:refs/heads/delivery
audit_dir=$(mktemp -d "$out/audit.XXXXXX")
git init --bare -q "$audit_dir"
git -C "$audit_dir" fetch --no-tags --no-write-fetch-head \
  "$root/tmp/pwd-evidence/backup/base.bundle" HEAD:refs/heads/base
[[ $(git -C "$audit_dir" rev-parse refs/heads/base) == $(git rev-parse "$BASE") ]]
if git -C "$audit_dir" cat-file -e "$head^{commit}" 2>/dev/null; then
  echo 'Delivery objects present before bundle import'; exit 2
fi
git -C "$audit_dir" bundle verify "$out/api-paniers-pwd.bundle" > "$out/isolated-verify.log" 2>&1
git -C "$audit_dir" fetch --no-tags --no-write-fetch-head \
  "$out/api-paniers-pwd.bundle" HEAD:refs/heads/delivery
[[ $(git -C "$audit_dir" rev-parse refs/heads/delivery) == "$head" ]]
[[ $(git -C "$audit_dir" rev-parse 'refs/heads/delivery^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
git -C "$audit_dir" fsck --full --no-reflogs > "$out/isolated-fsck.log" 2>&1
printf 'base=%s\nhead=%s\nmerge=%s\na5=%s\ntree=%s\naudit=%s\n' \
  "$(git rev-parse "$BASE")" "$head" "$merge" "$(git rev-parse "$merge^2")" \
  "$(git rev-parse 'HEAD^{tree}')" "$audit_dir" | tee "$out/identity.txt"
sha256sum "$out/api-paniers-pwd.bundle" | tee "$out/api-paniers-pwd.bundle.sha256"
