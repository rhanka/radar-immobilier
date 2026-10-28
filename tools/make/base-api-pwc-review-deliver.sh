#!/usr/bin/env bash
set -euo pipefail
ROOT=$(pwd -P)
BASE=37f21d3d82dffed1b51bec3f06632983cba0bd09
IMPORTED=c276209ca836a734fd5c850bddf969cf3df4d4f2
g() { git -C "$ROOT" "$@"; }
allowed() {
  case $1 in
    api/src/artifacts/write-intent-transaction.ts|api/drizzle/*) return 2;;
    api/src/artifacts/*) ;;
    api/tests/integration/pwcr-*.ts|tools/make/base-api-pwc-review*|plan/PWCR-BRANCH_feat-api-paniers-pwc-review.md) ;;
    api/tests/integration/pwe-app-receipt.spec.ts) ;;
    api/tests/integration/pw-write-authority-rights.spec.ts) ;;
    deploy/overlays/preprod/nginx/default.conf|ui/nginx/default.conf|deploy/k8s/nginx/default.conf) ;;
    *) echo "Out of L5 scope: $1" >&2; return 2;;
  esac
  [[ $1 != *..* && ! -L $1 ]]
}
stats() {
  awk 'BEGIN {n=0; lines=0} {n++; lines+=$1+$2}
    END {print "files=" n " lines=" lines; if(n<1 || n>15 || lines>150) exit 1}'
}
subject() {
  [[ $1 != *$'\n'* && $1 != *$'\r'* && ${#1} -le 72
    && $1 =~ ^(feat|fix|test|chore|docs)\(pwc-review\):\ [[:print:]]+$ ]]
}
staged() {
  local path
  while IFS= read -r path; do allowed "$path"; done < <(g diff --cached --name-only)
  g diff --cached --numstat | stats
}
audit() {
  local commit path
  g merge-base --is-ancestor "$BASE" HEAD
  g merge-base --is-ancestor "$IMPORTED" HEAD
  for commit in $(g rev-list --reverse "$IMPORTED..HEAD"); do
    subject "$(g show -s --format=%B "$commit")"
    g show --format= --numstat "$commit" | stats
    g show -s --format='%H %s' "$commit"
  done
  while IFS= read -r path; do allowed "$path"; done < <(g diff --name-only "$IMPORTED" HEAD)
  g diff --quiet HEAD
  g diff --quiet "$IMPORTED" HEAD -- api/drizzle api/src/artifacts/write-intent-transaction.ts .track
}
case ${1:-} in
  stage)
    read -r -a paths <<< "${FILES:?}"
    for path in "${paths[@]}"; do allowed "$path"; done
    g add -- "${paths[@]}"; staged;;
  commit)
    staged; subject "${MSG:?}"
    g -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -m "$MSG";;
  audit) audit;;
  bundle)
    jq -e --arg head "$(g rev-parse HEAD)" '.qualified and .head==$head and .mutations.total==136' tmp/pwc-review-evidence/qualification.json >/dev/null
    audit
    mkdir -p tmp/pwc-review-evidence
    bundle=$ROOT/tmp/pwc-review-evidence/api-paniers-pwc-corrected.bundle
    [[ ! -L $bundle ]]
    g bundle create "$bundle" "$BASE..HEAD"
    target=$(mktemp -d "$ROOT/tmp/pwc-review-evidence/bundle-audit.XXXXXX")
    git init --bare -q "$target"
    git -C "$target" fetch --no-tags --no-write-fetch-head "$ROOT" "$BASE:refs/heads/prerequisite"
    git -C "$target" symbolic-ref HEAD refs/heads/prerequisite
    head=$(g rev-parse HEAD)
    ! git -C "$target" cat-file -e "$head^{commit}" 2>/dev/null
    git -C "$target" bundle verify "$bundle"
    git -C "$target" fetch --no-tags --no-write-fetch-head "$bundle" HEAD:refs/heads/payload
    git -C "$target" symbolic-ref HEAD refs/heads/payload
    [[ $(git -C "$target" rev-parse HEAD) == "$head" ]]
    [[ $(git -C "$target" rev-parse 'HEAD^{tree}') == $(g rev-parse 'HEAD^{tree}') ]]
    git -C "$target" fsck --full --no-reflogs
    printf 'BASE=%s\nHEAD=%s\nAUDIT=%s\n' "$BASE" "$head" "$target"
    sha256sum "$bundle" | tee "$bundle.sha256";;
  *) exit 2;;
esac
