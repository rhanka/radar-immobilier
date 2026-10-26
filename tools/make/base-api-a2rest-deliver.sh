#!/usr/bin/env bash
# Local delivery objects only; the worktree's shared Git directory is read-only.
set -euo pipefail
action=${1:?}
ROOT=$(pwd -P)
BASE=$(git rev-parse 66ff7898)
LOCAL=$ROOT/tmp/a2base-rest-delivery.git
if [[ $action == setup ]]; then
  [[ $(git branch --show-current) == feat/artefacts-mcp-a2base-rest ]]
  [[ $(git rev-parse HEAD) == "$BASE" && ! -e $LOCAL ]]
  mkdir -p "$ROOT/tmp"
  git init --bare -q "$LOCAL"
  git --git-dir="$LOCAL" fetch --no-tags --no-write-fetch-head "$ROOT" "$BASE:refs/heads/feat/artefacts-mcp-a2base-rest"
  git --git-dir="$LOCAL" symbolic-ref HEAD refs/heads/feat/artefacts-mcp-a2base-rest
  git --git-dir="$LOCAL" config core.bare false
  git --git-dir="$LOCAL" config core.worktree "$ROOT"
  git --git-dir="$LOCAL" config user.name "Sol"
  git --git-dir="$LOCAL" config user.email "sol@local.invalid"
  git --git-dir="$LOCAL" read-tree HEAD
  exit
fi
export GIT_DIR=$LOCAL GIT_WORK_TREE=$ROOT
[[ $ENV == test-a2base-rest && -f $GIT_DIR/config && ! -L $GIT_DIR ]]
[[ $(git branch --show-current) == feat/artefacts-mcp-a2base-rest ]]
git merge-base --is-ancestor "$BASE" HEAD
allowed() {
  [[ $1 != *..* && $1 != /* && ! -L $1 ]] || return 2
  case $1 in
    api/src/app.ts|api/src/routes/graph-signals.ts|api/src/routes/mcp-signal-search*|api/src/services/facets/mcp-signal-*) ;;
    api/src/services/graph/regulatory-status-archi.test.ts) ;;
    api/src/services/facets/scope.ts|packages/immo-mcp/src/signal-read-error.ts|packages/immo-mcp/src/signal-read-error.test.ts) ;;
    api/tests/integration/mcp-signal-search*|api/tests/integration/a2base-mcp-fixture.ts|tools/make/base-api-a2rest*) ;;
    plan/ARTEFACTS-BRANCH_feat_artefacts-mcp.md|plan/ARTEFACTS-A2BASE-REST-BRANCH_feat_artefacts-mcp-a2base-rest.md) ;;
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
    [[ ${MSG:?} != *$'\n'* && ${MSG:?} != *$'\r'* && $MSG =~ ^(chore|docs|test|feat|fix|refacto)\([a-z]+\):\ .+ ]]
    git -c core.hooksPath=/dev/null commit -m "$MSG";;
  audit) audit; git status --short;;
  bundle)
    git diff --quiet; git diff --cached --quiet
    audit > tmp/a2base-rest-r2-commit-audit.txt
    OUT=$ROOT/tmp/a2base-rest-evidence/a2base-rest-astra-r2-corrections.bundle
    mkdir -p "${OUT%/*}"
    [[ ! -L ${OUT%/*} && ! -L $OUT ]]
    git bundle create "$OUT" "$BASE..HEAD"
    git bundle verify "$OUT"
    auditdir=$(mktemp -d "$ROOT/tmp/a2base-rest-evidence/bundle-audit.XXXXXX")
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
