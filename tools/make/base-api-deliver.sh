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
  awk -v minimum="${1:-1}" 'BEGIN {n=0; total=0} $1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ {exit 1}
    {n++; total+=$1+$2} END {print "files=" n " changed-lines=" total;
    if (n<minimum || n>15 || total>150) exit 1}'
}
audit_staged() {
  local paths p preview merge_head minimum=1
  [[ -z $(git ls-files -u) ]] || { echo 'Unresolved merge entries' >&2; return 2; }
  local comparison=()
  if merge_head=$(git rev-parse -q --verify MERGE_HEAD); then
    # Measure authored resolutions against Git's inherited merge candidate.
    # Imported history is retained and audited separately, never re-sliced.
    preview=$(git merge-tree --write-tree HEAD "$merge_head") || [[ $? == 1 ]]
    preview=${preview%%$'\n'*}
    [[ $preview =~ ^[a-f0-9]{40}$ ]] || return 2
    comparison=("$preview")
    minimum=0
  fi
  paths=$(git diff --cached --name-only "${comparison[@]}")
  [[ -n $paths || $minimum == 0 ]] || { echo 'Nothing staged' >&2; return 1; }
  while IFS= read -r p; do [[ -z $p ]] || allowed "$p"; done <<< "$paths"
  git diff --cached --numstat "${comparison[@]}" | stats "$minimum"
}
subject() {
  [[ $1 != *$'\n'* && $1 != *$'\r'* && ${#1} -le 72 && $1 =~ ^(chore|docs|test|feat|fix|refacto|ci)\(base\):\ [[:print:]]+$ ]]
}
audit_commit() {
  local sha=$1 message preview parents first second
  message=$(git show -s --format=%B "$sha")
  subject "$message" || { echo "Invalid subject/body/trailer: $sha" >&2; return 1; }
  parents=$(git show -s --format=%P "$sha")
  if [[ $parents == *' '* ]]; then
    read -r first second <<< "$parents"
    [[ $second != *' '* ]] || return 2
    preview=$(git merge-tree --write-tree "$first" "$second") || [[ $? == 1 ]]
    preview=${preview%%$'\n'*}
    git diff --numstat "$preview" "$sha" | stats 0
  else git show --format= --numstat "$sha" | stats; fi
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
    while IFS= read -r sha; do audit_commit "$sha"; done < <(git rev-list --first-parent --reverse "$BASE..HEAD")
    git status --short;;
  bundle)
    prerequisite=$BASE
    case $OUT in
      tmp/base-api-evidence/B0/base-api-b0.bundle) ;;
      tmp/base-api-evidence/B1/base-api-b1.bundle)
        [[ $(git branch --show-current) == feat/base-api-decouplee-b1 && $START =~ ^[a-f0-9]{40}$ ]] || exit 2
        git merge-base --is-ancestor 3c6d3c1f95d6794ba0939cf71db6b169cb3f071d "$START"
        git merge-base --is-ancestor "$START" HEAD
        prerequisite=$START;;
      *) exit 2;;
    esac
    df -h .
    [[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 10485760 ]] || exit 3
    for directory in tmp tmp/base-api-evidence "${OUT%/*}"; do [[ ! -L $directory ]] || exit 2; done
    mkdir -p "${OUT%/*}"
    [[ ! -L ${OUT%/*} && ! -L $OUT ]] || exit 2
    git bundle create "$OUT" "$prerequisite..HEAD"
    git bundle verify "$OUT"
    if [[ $OUT == tmp/base-api-evidence/B1/* ]]; then
      audit=$(mktemp -d "${OUT%/*}/bundle-audit.XXXXXX")
      bundle=$(realpath "$OUT")
      root=$(pwd -P)
      head=$(git rev-parse HEAD)
      git init --bare -q "$audit"
      git -C "$audit" fetch --no-tags --no-write-fetch-head "$root" "$prerequisite:refs/heads/prerequisite"
      git -C "$audit" symbolic-ref HEAD refs/heads/prerequisite
      if git -C "$audit" cat-file -e "$head^{commit}" 2>/dev/null; then
        echo 'Payload already exists in prerequisite audit repository' >&2; exit 2
      fi
      git -C "$audit" bundle verify "$bundle"
      git -C "$audit" fetch --no-tags --no-write-fetch-head "$bundle" HEAD:refs/heads/payload
      [[ $(git -C "$audit" rev-parse refs/heads/payload) == "$head" ]]
      git -C "$audit" fsck --full --no-reflogs
      printf 'Bundle prerequisite: %s\nIsolated audit repository: %s\n' "$prerequisite" "$audit"
    fi
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
