#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-bascule-fix ]]
base=76636465d6fce99b323f843f8c639e86167b002c
branch=fix/bascule-preprod-blockers
out=$PWD/tmp/bascule-fix-evidence/astra
isolated_git() { env -u GIT_DIR -u GIT_WORK_TREE git "$@"; }
audit_staged() {
  git diff --cached --check
  git diff --cached --numstat | awk '{n+=$1+$2;f++} END {exit !(n>0 && n<=150 && f<=15)}'
}
case $1 in
bootstrap)
  [[ ! -e $GIT_DIR ]]
  mkdir -p "$out"
  isolated_git init --bare -q "$GIT_DIR"
  git fetch --no-tags --no-write-fetch-head "$PWD" "$base:refs/heads/$branch"
  git symbolic-ref HEAD "refs/heads/$branch"
  git reset --mixed HEAD
  ;;
stage)
  read -r -a paths <<< "$FILES"
  for path in "${paths[@]}"; do
    case $path in
      tools/make/bascule-fix*|tools/make/base-preprod*|deploy/base-preprod/*|deploy/ci/check-release-sha.test.sh|deploy/ci/rollback-release*|api/Dockerfile|.github/workflows/build-push-images.yml|docs/spec/BASE_API_ACTIVATION.md|plan/BASCULEFIX-BRANCH_fix-bascule-preprod-blockers.md|RAPPORT-SOL-BASCULE-FIX.md) ;;
      *) exit 2;;
    esac
    [[ $path != *..* && ! -L $path ]]
  done
  git add -- "${paths[@]}"
  audit_staged;;
commit)
  audit_staged
  [[ $MSG =~ ^(fix|test|chore|docs|ci)\([a-z-]+\):\ [[:print:]]+$ && $MSG != *$'\n'* && ${#MSG} -le 72 ]]
  git -c core.hooksPath=/dev/null -c commit.gpgsign=false \
    -c user.name="$(git show -s --format=%an "$base")" -c user.email="$(git show -s --format=%ae "$base")" commit -m "$MSG";;
audit)
  while IFS= read -r revision; do
    subject=$(git show -s --format=%B "$revision")
    [[ $subject != *$'\n'* && ${#subject} -le 72 && $subject =~ ^(fix|test|chore|docs|ci)\([a-z-]+\):\  ]]
    git show --format= --numstat "$revision" | awk '{n+=$1+$2;f++} END {exit (n>150 || f>15)}'
  done < <(git rev-list "$base..HEAD")
  git diff --check "$base" HEAD
  git log --oneline "$base..HEAD";;
bundle)
  git diff --quiet; git diff --cached --quiet
  git bundle create "$out/bascule-fix.bundle" "$base..HEAD"
  auditdir=$(mktemp -d "$out/audit.XXXXXX.git")
  isolated_git init --bare -q "$auditdir"
  isolated_git -C "$auditdir" fetch --no-tags --no-write-fetch-head "$PWD" "$base:refs/heads/base"
  isolated_git -C "$auditdir" bundle verify "$out/bascule-fix.bundle"
  isolated_git -C "$auditdir" fetch --no-tags --no-write-fetch-head "$out/bascule-fix.bundle" "HEAD:refs/heads/$branch"
  [[ $(isolated_git -C "$auditdir" rev-parse "$branch") == $(git rev-parse HEAD) ]]
  [[ $(isolated_git -C "$auditdir" rev-parse "$branch^{tree}") == $(git rev-parse 'HEAD^{tree}') ]]
  isolated_git -C "$auditdir" fsck --full --no-reflogs
  jq -n --arg base "$base" --arg head "$(git rev-parse HEAD)" --arg audit "$auditdir" \
    --arg bundle "$out/bascule-fix.bundle" --arg sha256 "$(sha256sum "$out/bascule-fix.bundle" | cut -d' ' -f1)" \
    '{base:$base,head:$head,audit:$audit,bundle:$bundle,sha256:$sha256,verified:true}' > "$out/delivery.json"
  cat "$out/delivery.json";;
*) exit 2;;
esac
