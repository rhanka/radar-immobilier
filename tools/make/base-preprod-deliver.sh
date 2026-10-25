#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-base-preprod && $(git branch --show-current) == feat/base-preprod-operator ]]
# Snapshot of origin/main at task bootstrap; other lanes may advance the shared ref.
base=da24b28677f4c66e950967faa00b9f596044cf2e
git merge-base --is-ancestor "$base" HEAD
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
      api/Dockerfile|api/src/scripts/*|api/tests/integration/base-preprod*|tools/make/base-preprod*|deploy/base-preprod/*|docs/spec/BASE_API_ACTIVATION.md|plan/P1O1-BRANCH_base-preprod-operator.md|RAPPORT-SOL-BASE-PREPROD-P1O1.md) ;;
      *) exit 2;;
    esac
    [[ $path != *..* && ! -L $path ]]
  done
  git add -- "${files[@]}"
  audit;;
commit)
  audit
  [[ $MSG =~ ^(feat|fix|test|chore|docs)\(base\):\ [[:print:]]+$ && $MSG != *$'\n'* && ${#MSG} -le 72 ]]
  git -c core.hooksPath=/dev/null commit -m "$MSG";;
bundle)
  git diff --quiet; git diff --cached --quiet
  [[ $(df -Pk . | awk 'NR==2 {print $4}') -ge 8388608 ]]
  out=tmp/base-preprod-evidence/delivery
  mkdir -p "$out"
  git bundle create "$out/base-preprod-p1o1.bundle" "$base..HEAD"
  auditdir=$(mktemp -d "$out/audit.XXXXXX")
  git init --bare -q "$auditdir"
  git -C "$auditdir" fetch --no-tags --no-write-fetch-head "$(pwd -P)" "$base:refs/heads/base"
  if git -C "$auditdir" cat-file -e "$(git rev-parse HEAD)^{commit}" 2>/dev/null; then exit 2; fi
  git -C "$auditdir" bundle verify "$(pwd -P)/$out/base-preprod-p1o1.bundle"
  git -C "$auditdir" fetch --no-tags --no-write-fetch-head "$(pwd -P)/$out/base-preprod-p1o1.bundle" HEAD:refs/heads/payload
  git -C "$auditdir" symbolic-ref HEAD refs/heads/payload
  [[ $(git -C "$auditdir" rev-parse 'payload^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
  git -C "$auditdir" fsck --full --no-reflogs
  backupdir=$(mktemp -d "$out/backup.XXXXXX.git")
  git init --bare -q "$backupdir"
  git -C "$backupdir" fetch --no-tags --no-write-fetch-head "$(pwd -P)" HEAD:refs/heads/delivery
  git -C "$backupdir" symbolic-ref HEAD refs/heads/delivery
  git -C "$backupdir" fsck --full --no-reflogs
  printf 'Local backup repository: %s\nFresh bundle audit: %s\nBase: %s\n' "$backupdir" "$auditdir" "$base"
  sha256sum "$out/"*.bundle
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
