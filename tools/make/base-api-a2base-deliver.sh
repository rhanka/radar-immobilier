#!/usr/bin/env bash
# All authored objects/index/refs stay in a local backup, never in shared .git.
set -euo pipefail
action=${1:?}
BASE=c5fb85dbd77e12c0c4355a207de84ead0c3fa5d9
ROOT=$(pwd -P)
export GIT_DIR=$ROOT/tmp/a2base-api-delivery.git
export GIT_WORK_TREE=$ROOT
[[ $ENV == test-a2base-api && -f $GIT_DIR/config && ! -L $GIT_DIR ]]
[[ $(git branch --show-current) == feat/artefacts-mcp-a2base-api ]]
git merge-base --is-ancestor "$BASE" HEAD
allowed() {
  [[ $1 != *..* && $1 != /* && ! -L $1 ]] || return 2
  case $1 in
    api/src/routes/mcp-signal-search*|api/src/routes/graph-signals.ts|api/src/services/facets/mcp-signal-*|api/tests/integration/mcp-signal-search*|tools/make/base-api-a2base*) ;;
    plan/ARTEFACTS-BRANCH_feat_artefacts-mcp.md|plan/ARTEFACTS-A2BASE-API-BRANCH_feat_artefacts-mcp-a2base-api.md) ;;
    *) echo "Out of scope: $1" >&2; return 2;;
  esac
}
stats() {
  awk '$1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ {bad=1}
    {files++; lines+=$1+$2} END {print "files=" files " changed-lines=" lines;
    if(bad || files<1 || files>15 || lines>150) exit 1}'
}
staged() {
  [[ -z $(git ls-files -u) ]]
  while IFS= read -r path; do allowed "$path"; done < <(git diff --cached --name-only)
  git diff --cached --numstat | stats
}
audit() {
  local sha subject
  while IFS= read -r sha; do
    subject=$(git show -s --format=%B "$sha")
    [[ $subject != *$'\n'* && $subject =~ ^(chore|docs|test|feat|fix|refacto)\([a-z]+\):\ .+ ]]
    [[ $(git show -s --format=%P "$sha") != *' '* ]]
    git show --format= --numstat "$sha" | stats
    git show -s --format='%H %s' "$sha"
    while IFS= read -r path; do allowed "$path"; done < <(git diff-tree --no-commit-id --name-only -r "$sha")
  done < <(git rev-list --reverse "$BASE..HEAD")
}
case $action in
  stage)
    read -r -a paths <<< "${FILES:?}"
    for path in "${paths[@]}"; do allowed "$path"; done
    git add -- "${paths[@]}"
    staged;;
  commit)
    staged
    [[ ${MSG:?} != *$'\n'* && $MSG != *$'\r'* && $MSG =~ ^(chore|docs|test|feat|fix|refacto)\([a-z]+\):\ .+ ]]
    git -c core.hooksPath=/dev/null commit -m "$MSG";;
  audit) audit; git status --short;;
  bundle)
    git diff --quiet; git diff --cached --quiet
    audit > tmp/a2base-api-commit-audit.txt
    OUT=$ROOT/tmp/a2base-api-evidence/a2base-api.bundle
    mkdir -p "${OUT%/*}"
    [[ ! -L ${OUT%/*} && ! -L $OUT ]]
    git bundle create "$OUT" "$BASE..HEAD"
    git bundle verify "$OUT"
    auditdir=$(mktemp -d "$ROOT/tmp/a2base-api-evidence/bundle-audit.XXXXXX")
    independent() { env -u GIT_DIR -u GIT_WORK_TREE git -C "$auditdir" "$@"; }
    independent init --bare -q
    independent fetch --no-tags --no-write-fetch-head "$ROOT" "$BASE:refs/heads/prerequisite"
    independent symbolic-ref HEAD refs/heads/prerequisite
    head=$(git rev-parse HEAD)
    if independent cat-file -e "$head^{commit}" 2>/dev/null; then
      echo 'Payload already present before bundle import' >&2; exit 2
    fi
    independent bundle verify "$OUT"
    independent fetch --no-tags --no-write-fetch-head "$OUT" HEAD:refs/heads/payload
    [[ $(independent rev-parse refs/heads/payload) == "$head" ]]
    [[ $(independent rev-parse 'refs/heads/payload^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
    independent fsck --full --no-reflogs
    sha256sum "$OUT"
    printf 'Delivered SHA: %s\nAudit repository: %s\n' "$head" "$auditdir";;
  *) exit 2;;
esac
