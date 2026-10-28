#!/usr/bin/env bash
set -euo pipefail
[[ $ENV == test-api-paniers-pwa && $(git branch --show-current) == feat/api-paniers-pwa ]]
git merge-base --is-ancestor 39ed4f1b HEAD
allowed() {
  case $1 in
    api/drizzle/0025_pw_write_persistence.sql|api/drizzle/0027_pw_write_persistence.sql|api/drizzle/meta/_journal.json|\
    api/src/db/schema.ts|api/src/services/facets/pw-write-migration-db.test.ts|docs/spec/PW_D_PERSISTENCE.md|\
    tools/make/base-api-pwd-commit.sh|tools/make/base-api-pwd-deliver.sh|tools/make/base-api-pwd-corrections-deliver.sh) ;;
    api/src/artifacts/write-*|api/src/app.ts|api/src/config.ts|api/tests/integration/pw-write-authority*|\
    api/tests/integration/pw-write-createapp.spec.ts|tools/make/base-api-pwa*|plan/PWA-BRANCH_feat-api-paniers-pwa.md) ;;
    *) echo "Out of scope: $1" >&2; return 2;;
  esac
  [[ $1 != *..* && ! -L $1 ]]
}
audit_staged() {
  git diff --cached --check
  while IFS= read -r file; do allowed "$file"; done < <(git diff --cached --name-only)
  git diff --cached --numstat | awk '{n += $1+$2; f++} END {print "files=" f, "lines=" n; exit !(n>0 && n<=150 && f<=15)}'
}
case $1 in
  stage)
    read -r -a files <<< "$FILES"
    for file in "${files[@]}"; do allowed "$file"; done
    git add -- "${files[@]}"
    audit_staged;;
  commit)
    audit_staged
    [[ $MSG =~ ^(feat|fix|test|docs|chore)\(pw-a\):\ [[:print:]]+$ && $MSG != *$'\n'* && ${#MSG} -le 72 ]]
    git -c core.hooksPath=/dev/null commit -m "$MSG";;
  *) exit 2;;
esac
