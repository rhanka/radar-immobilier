#!/usr/bin/env bash
set -euo pipefail
action=${1:?}
BASE=600d78485965361c89109bf61eccaa0250cf7284
ROOT=$(pwd -P)
[[ $ENV == test-api-paniers && $API_PORT == 18927 && $UI_PORT == 15927 && $MAILDEV_UI_PORT == 11927 ]]
backup=$ROOT/tmp/classification-delivery.git
if [[ $action == init ]]; then
  [[ ! -e $backup && $(git branch --show-current) == feat/api-paniers-read ]]
  [[ $(git rev-parse HEAD) == "$BASE" ]]
  mkdir -p tmp/classification-evidence
  git clone --bare --no-hardlinks . "$backup"
fi
export GIT_DIR=$backup GIT_WORK_TREE=$ROOT
[[ -f $GIT_DIR/config && ! -L $GIT_DIR ]]
[[ $(git branch --show-current) == feat/api-paniers-read ]]
git merge-base --is-ancestor "$BASE" HEAD
allowed() {
  [[ $1 != *..* && $1 != /* && ! -L $1 ]]
  case $1 in
    api/src/services/facets/classification-*|api/src/services/facets/projection-revisions-fixture.ts|api/src/routes/scoped-classification*|api/tests/integration/classification-*|tools/make/classification*|plan/PANIERSREAD-BRANCH_feat-api-paniers-read.md|RAPPORT-SOL-API-PANIERS-READ.md|api/src/app.ts) ;;
    *) echo "Outside classification scope: $1" >&2; return 2;;
  esac
}
stats() {
  awk '$1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ {bad=1} {n++; total+=$1+$2; added+=$1; removed+=$2}
    END {print "files=" n " added=" added " removed=" removed " changed-lines=" total; if(bad || n<1 || n>15 || total>150) exit 1}'
}
staged() {
  while IFS= read -r p; do allowed "$p"; done < <(git diff --cached --name-only)
  git diff --cached --numstat | stats
}
case $action in
  init) git read-tree HEAD; git status --short;;
  stage) read -r -a paths <<< "${FILES:?}"; for p in "${paths[@]}"; do allowed "$p"; done; git add -- "${paths[@]}"; staged;;
  commit)
    staged
    [[ ${MSG:?} != *$'\n'* && $MSG != *$'\r'* && $MSG =~ ^(feat|fix|test|chore|docs)\(classification\):\ .+ ]]
    git -c user.name=Codex -c user.email=codex@users.noreply.github.com -c core.hooksPath=/dev/null commit -m "$MSG";;
  state) git status --short; git log -4 --oneline; df -h .; docker ps --format '{{.Names}} {{.Status}}'; pgrep -af 'docker (build|buildx)' || true;;
  audit)
    while IFS= read -r sha; do
      message=$(git show -s --format=%B "$sha")
      [[ $message != *$'\n'* && $message =~ ^(feat|fix|test|chore|docs)\(classification\):\ .+ ]]
      git show --format= --numstat "$sha" | stats
      git show -s --format='%H %s' "$sha"
      while IFS= read -r p; do allowed "$p"; done < <(git diff-tree --no-commit-id --name-only -r "$sha")
    done < <(git rev-list --reverse "$BASE..HEAD");;
  bundle)
    git diff --quiet; git diff --cached --quiet
    out=$ROOT/tmp/classification-evidence/api-paniers-read.bundle
    git bundle create "$out" "$BASE..HEAD"
    audit=$(mktemp -d "$ROOT/tmp/classification-evidence/bundle-audit.XXXXXX")
    independent() { env -u GIT_DIR -u GIT_WORK_TREE git -C "$audit" "$@"; }
    independent init --bare -q
    independent fetch --no-tags "$ROOT" "$BASE:refs/heads/base"
    independent symbolic-ref HEAD refs/heads/base
    head=$(git rev-parse HEAD)
    if independent cat-file -e "$head^{commit}" 2>/dev/null; then exit 2; fi
    independent bundle verify "$out"
    independent fetch --no-tags "$out" HEAD:refs/heads/delivered
    [[ $(independent rev-parse refs/heads/delivered) == "$head" ]]
    [[ $(independent rev-parse 'refs/heads/delivered^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
    independent fsck --full --no-reflogs
    sha256sum "$out"; git rev-parse HEAD; echo "$audit";;
  *) exit 2;;
esac 7>tmp/classification-docker.lock
