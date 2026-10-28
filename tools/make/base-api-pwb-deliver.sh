#!/usr/bin/env bash
# Local-only delivery: bounded commits and a base-seeded independent bundle audit.
set -euo pipefail
BASE=b09a8ccccab5d7256c0a08b8b93979dbec57b65f
[[ $(git branch --show-current) == feat/api-paniers-write ]]
[[ ${ENV:-} == test-api-paniers-w ]]
git merge-base --is-ancestor "$BASE" HEAD
git diff --exit-code
git diff --cached --exit-code
[[ -z $(git ls-files --others --exclude-standard) ]] || { echo 'Uncommitted delivery files'; exit 2; }
root=$(pwd -P)
head=$(git rev-parse HEAD)
out=$root/tmp/pwb-evidence/delivery-review
mkdir -p "$out"
allowed() {
  case $1 in
    api/src/services/facets/signal-write-*|api/src/services/facets/scoped-writer.ts|\
    api/src/services/facets/workspace-writer.ts|api/src/services/facets/projection-revisions.ts|\
    api/tests/integration/base-api-pwb-*|tools/make/base-api-pwb*|\
    docs/spec/PW_B_ADMISSION.md|plan/PWB-BRANCH_feat-api-paniers-write.md) ;;
    *) echo "Outside PW-B scope: $1" >&2; return 1;;
  esac
}
audit() {
  local sha subject body stats count total
  while IFS= read -r sha; do
    subject=$(git show -s --format=%s "$sha")
    body=$(git show -s --format=%B "$sha")
    [[ $body == "$subject" && $subject =~ ^(feat|fix|refacto|test|docs|chore)\(pwb\):\  ]]
    [[ $(git show -s --format=%P "$sha") != *' '* ]] || return 1
    stats=$(git show --format= --numstat "$sha")
    read -r count total < <(awk '{n++; total+=$1+$2} END {print n,total}' <<< "$stats")
    [[ $count -ge 1 && $count -le 15 && $total -le 150 ]] || return 1
    while IFS= read -r path; do allowed "$path"; done < <(git diff-tree --no-commit-id --name-only -r "$sha")
    printf '%s\t%s\t%s\t%s\n' "$sha" "$count" "$total" "$subject"
  done < <(git rev-list --reverse "$BASE..HEAD")
}
audit | tee "$out/commits.tsv"
git diff --check "$BASE" HEAD
git diff --numstat "$BASE" HEAD > "$out/numstat.tsv"
git bundle create "$out/api-paniers-pwb.bundle" "$BASE..HEAD"
git bundle verify "$out/api-paniers-pwb.bundle" > "$out/bundle-verify.log" 2>&1
git bundle list-heads "$out/api-paniers-pwb.bundle" > "$out/bundle-heads.txt"
git -C tmp/pwb-evidence/rescue.git fetch --no-tags "$root" HEAD:refs/heads/delivery
audit_dir=$(mktemp -d "$out/audit.XXXXXX")
git init --bare -q "$audit_dir"
# Fetch the original pre-work backup, never the feature worktree, as prerequisite.
git -C "$audit_dir" fetch --no-tags --no-write-fetch-head "$root/tmp/pwb-evidence/review-backup/b09a8ccc.bundle" HEAD:refs/heads/base
[[ $(git -C "$audit_dir" rev-parse refs/heads/base) == "$BASE" ]]
git -C "$audit_dir" symbolic-ref HEAD refs/heads/base
if git -C "$audit_dir" cat-file -e "$head^{commit}" 2>/dev/null; then
  echo 'Delivery objects already present before bundle import'; exit 2
fi
git -C "$audit_dir" bundle verify "$out/api-paniers-pwb.bundle" > "$out/isolated-verify.log" 2>&1
git -C "$audit_dir" fetch --no-tags --no-write-fetch-head "$out/api-paniers-pwb.bundle" HEAD:refs/heads/delivery
[[ $(git -C "$audit_dir" rev-parse refs/heads/delivery) == "$head" ]]
[[ $(git -C "$audit_dir" rev-parse 'refs/heads/delivery^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
git -C "$audit_dir" fsck --full --no-reflogs > "$out/isolated-fsck.log" 2>&1
printf 'base=%s\nhead=%s\ntree=%s\naudit=%s\n' "$BASE" "$head" "$(git rev-parse 'HEAD^{tree}')" "$audit_dir" \
  | tee "$out/identity.txt"
sha256sum "$out/api-paniers-pwb.bundle" | tee "$out/api-paniers-pwb.bundle.sha256"
