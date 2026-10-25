#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-base-preprod && $(git branch --show-current) == feat/base-preprod-operator ]]
# Snapshot of origin/main at task bootstrap; other lanes may advance the shared ref.
base=c100e6cc0897bebc42c94157d8cb94f28348cab2
git merge-base --is-ancestor "$base" HEAD
isolated_git() { env -u GIT_DIR -u GIT_WORK_TREE git "$@"; }
audit() {
  local count
  count=$(git diff --cached --numstat | awk '{n+=$1+$2} END {print n+0}')
  [[ $count -gt 0 && $count -le 150 ]]
  git diff --cached --check
}
case $1 in
stage)
  read -r -a files <<< "$FILES"
  for path in "${files[@]}"; do
    case $path in
      api/Dockerfile|api/src/scripts/*|api/tests/integration/base-preprod*|tools/make/base-preprod*|deploy/base-preprod/*|deploy/ci/check-image-entrypoints.test.sh|docs/spec/BASE_API_ACTIVATION.md|plan/P1O1-BRANCH_base-preprod-operator.md|RAPPORT-SOL-BASE-PREPROD-P1O1.md) ;;
      *) exit 2;;
    esac
    [[ $path != *..* && ! -L $path ]]
  done
  git add -- "${files[@]}"
  audit;;
commit)
  audit
  [[ $MSG =~ ^(feat|fix|test|chore|docs)\(base\):\ [[:print:]]+$ && $MSG != *$'\n'* && ${#MSG} -le 72 ]]
  git -c core.hooksPath=/dev/null -c user.name="$(git show -s --format=%an "$base")" \
    -c user.email="$(git show -s --format=%ae "$base")" commit -m "$MSG";;
bundle)
  git diff --quiet; git diff --cached --quiet
  [[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 8388608 ]]
  out=tmp/base-preprod-evidence/delivery
  mkdir -p "$out"
  payload=$out/base-preprod-pr920-fixes.bundle
  git bundle create "$payload" "$base..HEAD"
  auditdir=$(mktemp -d "$out/audit.XXXXXX")
  isolated_git init --bare -q "$auditdir"
  isolated_git -C "$auditdir" fetch --no-tags --no-write-fetch-head "$GIT_DIR" "$base:refs/heads/base"
  if isolated_git -C "$auditdir" cat-file -e "$(git rev-parse HEAD)^{commit}" 2>/dev/null; then exit 2; fi
  isolated_git -C "$auditdir" bundle verify "$(pwd -P)/$payload"
  isolated_git -C "$auditdir" fetch --no-tags --no-write-fetch-head "$(pwd -P)/$payload" HEAD:refs/heads/payload
  isolated_git -C "$auditdir" symbolic-ref HEAD refs/heads/payload
  [[ $(isolated_git -C "$auditdir" rev-parse HEAD) == $(git rev-parse HEAD) ]]
  [[ $(isolated_git -C "$auditdir" rev-parse 'payload^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
  isolated_git -C "$auditdir" fsck --full --no-reflogs
  backupdir=$(mktemp -d "$out/backup.XXXXXX.git")
  isolated_git init --bare -q "$backupdir"
  isolated_git -C "$backupdir" fetch --no-tags --no-write-fetch-head "$GIT_DIR" HEAD:refs/heads/delivery
  isolated_git -C "$backupdir" symbolic-ref HEAD refs/heads/delivery
  [[ $(isolated_git -C "$backupdir" rev-parse HEAD) == $(git rev-parse HEAD) ]]
  isolated_git -C "$backupdir" fsck --full --no-reflogs
  printf 'Local backup repository: %s\nFresh bundle audit: %s\nBase: %s\n' "$backupdir" "$auditdir" "$base"
  sha256sum "$payload"
  git rev-parse HEAD;;
audit)
  while IFS= read -r sha; do
    subject=$(git show -s --format=%B "$sha")
    [[ $subject =~ ^(feat|fix|test|chore|docs)\(base\):\ [[:print:]]+$ && $subject != *$'\n'* && ${#subject} -le 72 ]]
    git show --format= --numstat "$sha" | awk '{n+=$1+$2;files++} END {if(n>150 || files>15)exit 1}'
  done < <(git rev-list --reverse "$base..HEAD")
  git diff --check "$base" HEAD
  git log --oneline "$base..HEAD";;
*) exit 2;;
esac
