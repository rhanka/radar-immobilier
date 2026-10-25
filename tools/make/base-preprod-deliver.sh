#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-base-preprod && $(git branch --show-current) == feat/base-preprod-operator ]]
base=$(git rev-parse origin/main)
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
  out=tmp/base-preprod-evidence/delivery
  mkdir -p "$out"
  git bundle create "$out/base-preprod-p1o1.bundle" "$base..HEAD"
  auditdir=$(mktemp -d "$out/audit.XXXXXX")
  git init --bare -q "$auditdir"
  git -C "$auditdir" fetch --no-tags --no-write-fetch-head "$(pwd -P)" "$base:refs/heads/base"
  if git -C "$auditdir" cat-file -e 'HEAD^{commit}' 2>/dev/null; then exit 2; fi
  git -C "$auditdir" bundle verify "$(pwd -P)/$out/base-preprod-p1o1.bundle"
  git -C "$auditdir" fetch --no-tags --no-write-fetch-head "$(pwd -P)/$out/base-preprod-p1o1.bundle" HEAD:refs/heads/payload
  [[ $(git -C "$auditdir" rev-parse 'payload^{tree}') == $(git rev-parse 'HEAD^{tree}') ]]
  git -C "$auditdir" fsck --full --no-reflogs
  git bundle create "$out/backup-full.bundle" --all
  sha256sum "$out/"*.bundle
  git rev-parse HEAD;;
*) exit 2;;
esac
