#!/usr/bin/env bash
# Bounded local history only. No push, activation or generated evidence staging.
set -euo pipefail
ACTION=${1:-}; shift || true
FILES= MSG= OUT= SLUG= BRANCH= START= SRC= ENV= RECEIPT=
for kv in "$@"; do case $kv in
  FILES=*) FILES=${kv#*=};; MSG=*) MSG=${kv#*=};; OUT=*) OUT=${kv#*=};;
  SLUG=*) SLUG=${kv#*=};; BRANCH=*) BRANCH=${kv#*=};; START=*) START=${kv#*=};;
  SRC=*) SRC=${kv#*=};; ENV=*) ENV=${kv#*=};; RECEIPT=*) RECEIPT=${kv#*=};;
esac; done
BASE=9a81508704b8ee247e3d402f9cbf15d458edfe2a
source "$(dirname -- "$0")/base-api-guards.sh"
require_env
[[ $(git branch --show-current) == feat/base-api-decouplee* ]] || exit 2
git merge-base --is-ancestor "$BASE" HEAD
allowed() {
  case $1 in
    plan/BASEAPI-BRANCH_feat_base-api-decouplee.md|docs/spec/SPEC_EVOL_BASE_API.md|tools/make/base-api*.sh|tools/make/base-api*.mk|tools/make/base-api*.mjs) ;;
    api/src/app.ts|api/src/index.ts|api/src/routes/auth.ts|api/src/db/schema.ts|api/drizzle/*|tools/make/paniers-lot6.mk|tools/make/paniers-lot6-verify.sh) ;;
    api/src/services/facets/*|api/src/routes/scoped-*|api/src/routes/workspaces.ts|api/src/routes/signal-facets*|api/src/routes/graph-signals*|api/tests/integration/base-api*) ;;
    *) echo "Out-of-scope staging: $1" >&2; return 2;;
  esac
  [[ ! -L $1 && $1 != *..* ]]
}
stats() {
  awk 'BEGIN {n=0; total=0} $1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ {exit 1}
    {n++; total+=$1+$2} END {print "files=" n " changed-lines=" total;
    if (n<1 || n>15 || total>150) exit 1}'
}
audit_staged() {
  local paths p
  paths=$(git diff --cached --name-only)
  [[ -n $paths ]] || { echo 'Nothing staged' >&2; return 1; }
  while IFS= read -r p; do allowed "$p"; done <<< "$paths"
  git diff --cached --numstat | stats
}
subject() {
  [[ $1 != *$'\n'* && $1 != *$'\r'* && ${#1} -le 72 && $1 =~ ^(chore|docs|test|feat|fix|refacto|ci)\(base\):\ [[:print:]]+$ ]]
}
audit_commit() {
  local sha=$1 message
  message=$(git show -s --format=%B "$sha")
  subject "$message" || { echo "Invalid subject/body/trailer: $sha" >&2; return 1; }
  git show --format= --numstat "$sha" | stats
  git show -s --format='%H %s' "$sha"
}
case $ACTION in
  stage)
    [[ -n $FILES ]] || exit 2
    read -r -a paths <<< "$FILES"
    for p in "${paths[@]}"; do allowed "$p"; done
    git add -- "${paths[@]}"
    audit_staged;;
  commit)
    audit_staged; subject "$MSG"
    git -c core.hooksPath=/dev/null commit -m "$MSG"
    audit_commit HEAD;;
  audit)
    while IFS= read -r sha; do audit_commit "$sha"; done < <(git rev-list --reverse "$BASE..HEAD")
    git status --short;;
  bundle)
    [[ $OUT == tmp/base-api-evidence/B0/base-api-b0.bundle ]] || exit 2
    mkdir -p "${OUT%/*}"
    [[ ! -L ${OUT%/*} && ! -L $OUT ]] || exit 2
    git bundle create "$OUT" "$BASE..HEAD"
    git bundle verify "$OUT"
    sha256sum "$OUT"
    git rev-parse HEAD;;
  worktree)
    [[ $SLUG =~ ^tmp/base-api-b[12]$ && $BRANCH == "feat/base-api-decouplee-${SLUG##*-}" && $START =~ ^[a-f0-9]{40}$ ]] || exit 2
    root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
    [[ ! -L $root/tmp && ! -L $root/$SLUG ]] || exit 2
    git worktree add "$root/$SLUG" -b "$BRANCH" "$START";;
  integrate)
    # The conductor supplies an acknowledged CT-2 receipt before shared imports.
    [[ $SRC =~ ^[a-f0-9]{40}$ && $RECEIPT == tmp/base-api-evidence/* && $RECEIPT != *..* && -s $RECEIPT ]] || exit 2
    git diff --quiet; git diff --cached --quiet
    git -c core.hooksPath=/dev/null merge --no-ff --no-squash "$SRC" -m 'chore(base): integrate qualified source history';;
  *) echo "Unknown delivery action: $ACTION" >&2; exit 2;;
esac
