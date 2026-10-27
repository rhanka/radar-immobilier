#!/usr/bin/env bash
# B2 handoff retains the entire pinned history and requires exactly K_SHA.
set -euo pipefail
source "$(dirname -- "$0")/base-api-guards.sh"
require_env
K_SHA=fd39c6168404b250c243222abe1fbba24d5480b0
B0_SHA=8abeff79fa9cff47d1f7a84288c44b4ccbe6a6d0
[[ $(git branch --show-current) == feat/base-api-decouplee-b2 ]]
git merge-base --is-ancestor "$K_SHA" HEAD
ROOT=$(pwd -P)
OUT=$ROOT/tmp/base-api-evidence/B2
mkdir -p "$OUT"
[[ ! -L $OUT && ! -L $OUT/base-api-b2.bundle ]]
git diff --quiet
git diff --cached --quiet
[[ -z $(git ls-files --others --exclude-standard) ]]
git diff --exit-code "$K_SHA" HEAD -- api/src/app.ts api/src/index.ts api/src/routes/auth.ts \
  api/src/db/schema.ts api/drizzle > "$OUT/shared-files.diff"
: > "$OUT/authored-audit.txt"
while IFS= read -r sha; do
  message=$(git show -s --format=%B "$sha")
  [[ $message != *$'\n'* && $message != *$'\r'* && ${#message} -le 72 ]]
  [[ $message =~ ^(fix|test|chore|refacto|docs)\(base\):\ [[:print:]]+$ ]]
  git show --format= --numstat "$sha" | awk '
    {if ($1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/) exit 1; n++; lines+=$1+$2}
    END {print "files=" n " changed-lines=" lines; if(n<1 || n>15 || lines>150) exit 1}' \
    >> "$OUT/authored-audit.txt"
  git show -s --format='%H %s' "$sha" >> "$OUT/authored-audit.txt"
done < <(git rev-list --reverse "$K_SHA..HEAD")
git log --reverse --format='%H %s' "$K_SHA..HEAD" > "$OUT/commits.txt"
git diff --numstat "$K_SHA" HEAD > "$OUT/changed-numstat.tsv"
git diff --name-only "$K_SHA" HEAD | xargs wc -l > "$OUT/line-counts.txt"
cp api/drizzle/meta/_journal.json "$OUT/frozen-journal.json"
sed -n 's/.*"tag": "\([^"]*\)".*/\1/p' api/drizzle/meta/_journal.json | \
  while IFS= read -r tag; do sha256sum "api/drizzle/$tag.sql"; done > "$OUT/expected-sql-hashes.txt"
printf 'B0_SHA=%s\nK_SHA=%s\nB2_SHA=%s\n' "$B0_SHA" "$K_SHA" "$(git rev-parse HEAD)" > "$OUT/revisions.txt"
git bundle create "$OUT/base-api-b2.bundle" "$K_SHA..refs/heads/feat/base-api-decouplee-b2"
git bundle verify "$OUT/base-api-b2.bundle" 2>&1 | tee "$OUT/bundle-verify.txt"
sed -n '/^$/q;p' "$OUT/base-api-b2.bundle" > "$OUT/bundle-header.txt"
[[ $(sed -n '2p' "$OUT/bundle-header.txt") == "-$K_SHA "* ]]
RECONSTRUCTION=$(mktemp -d "$OUT/reconstruction-XXXXXX")
git init --bare "$RECONSTRUCTION" > "$OUT/reconstruction.log" 2>&1
git -C "$RECONSTRUCTION" fetch --no-tags "$ROOT" "$K_SHA:refs/heads/baseline" >> "$OUT/reconstruction.log" 2>&1
git -C "$RECONSTRUCTION" bundle verify "$OUT/base-api-b2.bundle" >> "$OUT/reconstruction.log" 2>&1
git -C "$RECONSTRUCTION" fetch "$OUT/base-api-b2.bundle" \
  refs/heads/feat/base-api-decouplee-b2:refs/heads/reconstructed >> "$OUT/reconstruction.log" 2>&1
[[ $(git -C "$RECONSTRUCTION" rev-parse refs/heads/reconstructed) == "$(git rev-parse HEAD)" ]]
git -C "$RECONSTRUCTION" merge-base --is-ancestor "$K_SHA" refs/heads/reconstructed
git -C "$RECONSTRUCTION" diff --quiet "$K_SHA^{tree}" "refs/heads/baseline^{tree}"
[[ $(git -C "$RECONSTRUCTION" rev-parse 'refs/heads/reconstructed^{tree}') == "$(git rev-parse 'HEAD^{tree}')" ]]
git -C "$RECONSTRUCTION" fsck --no-dangling >> "$OUT/reconstruction.log" 2>&1
printf 'PASS exact K prerequisite and B2 tree reconstruction\n' >> "$OUT/reconstruction.log"
sha256sum "$OUT/base-api-b2.bundle" | tee "$OUT/bundle.sha256"
