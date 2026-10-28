#!/usr/bin/env bash
# Selective, bounded commits of the qualified PW-D worktree; no hooks or trailers.
set -euo pipefail
[[ ${ENV:-} == test-api-paniers-pwd ]]
[[ $(git branch --show-current) == feat/api-paniers-pwd ]]
plan=plan/PWD-BRANCH_feat-api-paniers-pwd.md
git restore --staged -- api/drizzle/meta/_journal.json api/src/db/schema.ts
git diff --cached --quiet
count=0
commit_slice() {
  local message=$1 total
  count=$((count + 1))
  printf '\n- [x] Delivery slice %02d: %s.\n' "$count" "$message" >> "$plan"
  git add -- "$plan"
  total=$(git diff --cached --numstat | awk '{n+=$1+$2} END {print n+0}')
  [[ $total -gt 0 && $total -le 150 ]] || { echo "Oversized slice: $total"; exit 2; }
  make --no-print-directory -f tools/make/base-api-pwd.mk commit MSG="$message" ENV="$ENV"
}
git add -- "$plan"
commit_slice 'docs(pw-d): declare integration and qualification scope'
migration=api/drizzle/0027_pw_write_persistence.sql
blob=$(awk '/^CREATE OR REPLACE FUNCTION guard_pw_write_append_only/{exit} {print}' "$migration" | git hash-object -w --stdin)
git update-index --add --cacheinfo "100644,$blob,$migration"
commit_slice 'feat(pw-d): add durable write persistence tables'
git add -- "$migration"
commit_slice 'feat(pw-d): enforce immutable records and outbox delivery'
paths=(api/drizzle/meta/_journal.json api/src/db/schema-pw-write.ts api/src/db/schema.ts
  api/tests/integration/artifacts-finalization-authorization.spec.ts)
for file in "${paths[@]}"; do
  git add -- "$file"
  commit_slice "feat(pw-d): register $(basename "$file")"
done
while IFS= read -r file; do
  [[ -f $file ]] || continue
  case $file in
    *test.ts|*.spec.ts|*fixture.ts) type=test;;
    docs/*) type=docs;;
    tools/*) type=chore;;
    *) type=feat;;
  esac
  git add -- "$file"
  commit_slice "$type(pw-d): add $(basename "$file")"
done < <(git ls-files --others --exclude-standard -- api/src/services/facets/pw-write* \
  api/tests/integration/pw-write* docs/spec/PW_D_PERSISTENCE.md tools/make/base-api-pwd*)
git diff --quiet
git diff --cached --quiet
[[ -z $(git ls-files --others --exclude-standard) ]]
