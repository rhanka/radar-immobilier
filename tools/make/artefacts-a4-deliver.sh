#!/usr/bin/env bash
set -euo pipefail
action=${1:?}
ROOT=$(pwd -P)
BASE=$(git rev-parse 77cb9553)
LOCAL=$ROOT/tmp/a4-delivery.git
[[ $ENV == test-artefacts-a4 ]]
if [[ $action == setup ]]; then
  [[ $(git branch --show-current) == feat/artefacts-mcp-a4 && ! -e $LOCAL ]]
  mkdir -p "$ROOT/tmp"
  git init --bare -q "$LOCAL"
  git --git-dir="$LOCAL" fetch --no-tags --no-write-fetch-head "$ROOT" "$BASE:refs/heads/feat/artefacts-mcp-a4"
  git --git-dir="$LOCAL" symbolic-ref HEAD refs/heads/feat/artefacts-mcp-a4
  git --git-dir="$LOCAL" config core.bare false
  git --git-dir="$LOCAL" config core.worktree "$ROOT"
  git --git-dir="$LOCAL" config user.name Sol
  git --git-dir="$LOCAL" config user.email sol@local.invalid
  git --git-dir="$LOCAL" read-tree HEAD
  exit
fi
export GIT_DIR=$LOCAL GIT_WORK_TREE=$ROOT
[[ -f $LOCAL/config && ! -L $LOCAL ]]
git merge-base --is-ancestor "$BASE" HEAD
allowed() {
  [[ $1 != *..* && $1 != /* && ! -L $1 ]]
  case $1 in
    packages/immo-mcp/*|packages/artifacts-host/*|package.json|package-lock.json|api/Dockerfile) ;;
    tools/make/artefacts-a4*|tools/h4-mcp.mk|docs/operator/artefacts-mcp.md) ;;
    api/tests/integration/a2base-mcp-fixture.ts|api/tests/integration/a2base-mcp-authority.spec.ts|api/src/services/graph/regulatory-status-archi.test.ts) ;;
    tools/exchange-issuer/service-fixture.ts) ;;
    plan/ARTEFACTS-A4-BRANCH_feat_artefacts-mcp-a4.md|RAPPORT-SOL-ARTEFACTS-A4.md) ;;
    *) echo "Outside A4 scope: $1" >&2; exit 2;;
  esac
}
stats() {
  awk '{ files++; lines+=$1+$2 } END { print "files=" files " changed-lines=" lines;
    if (files<1 || files>15 || lines>150) exit 1 }'
}
audit() {
  local sha subject
  while IFS= read -r sha; do
    subject=$(git show -s --format=%B "$sha")
    [[ $subject != *$'\n'* && $subject =~ ^(feat|fix|test|docs|chore|refacto)\([a-z0-9-]+\):\ .+ ]]
    git show --format= --numstat "$sha" | stats
    git show -s --format='%H %s' "$sha"
  done < <(git rev-list --reverse "$BASE..HEAD")
}
case $action in
  stage) for path in $FILES; do allowed "$path"; git add -- "$path"; done;;
  commit)
    while IFS= read -r path; do allowed "$path"; done < <(git diff --cached --name-only)
    git diff --cached --check
    git diff --cached --numstat | stats
    [[ $MSG != *$'\n'* && $MSG =~ ^(feat|fix|test|docs|chore|refacto)\([a-z0-9-]+\):\ .+ ]]
    git -c core.hooksPath=/dev/null commit -m "$MSG";;
  audit) audit;;
  bundle)
    audit > "$ROOT/tmp/a4-evidence/commit-audit.txt"
    OUT=$ROOT/tmp/a4-evidence/artefacts-a4.bundle
    git bundle create "$OUT" "$BASE..HEAD"
    auditdir=$(mktemp -d "$ROOT/tmp/a4-evidence/bundle-audit.XXXXXX")
    independent() { env -u GIT_DIR -u GIT_WORK_TREE git -C "$auditdir" "$@"; }
    independent init --bare -q
    independent fetch --no-tags --no-write-fetch-head "$ROOT" "$BASE:refs/heads/prerequisite"
    head=$(git rev-parse HEAD)
    ! independent cat-file -e "$head^{commit}" 2>/dev/null
    independent bundle verify "$OUT"
    independent fetch --no-tags --no-write-fetch-head "$OUT" HEAD:refs/heads/payload
    [[ $(independent rev-parse refs/heads/payload) == "$head" ]]
    [[ $(independent rev-parse 'refs/heads/payload^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
    independent fsck --full --no-reflogs
    sha256sum "$OUT"
    printf 'Delivered SHA: %s\nAudit repository: %s\n' "$head" "$auditdir";;
  *) exit 2;;
esac
