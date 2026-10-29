#!/usr/bin/env bash
# Local rescue history only; never writes the shared Git directory or pushes.
set -euo pipefail
ROOT=$(pwd -P)
BASE=509e664d422cba43bd9d27f9488afe6ad7eba9b9
REPO=$ROOT/tmp/pwc-delivery.git
g() { git --git-dir="$REPO" --work-tree="$ROOT" "$@"; }
allowed() {
  case $1 in
    api/src/artifacts/write-intent-transaction.ts) return 2;;
    api/src/artifacts/write-intent-*|api/src/artifacts/content-serve.ts|api/src/artifacts/content-serve.test.ts) ;;
    api/tests/integration/pw-write-authority-rights.spec.ts) ;;
    ui/nginx/default.conf|deploy/k8s/nginx/default.conf|tools/make/base-api-pwc*) ;;
    plan/PWC-BRANCH_feat-api-paniers-pwc.md) ;;
    *) echo "Out of scope: $1" >&2; return 2;;
  esac
  [[ $1 != *..* && ! -L $1 ]]
}
stats() {
  awk 'BEGIN {n=0; lines=0} {n++; lines+=$1+$2}
    END {print "files=" n " lines=" lines; if(n<1 || n>15 || lines>150) exit 1}'
}
subject() {
  [[ $1 != *$'\n'* && $1 != *$'\r'* && ${#1} -le 72
    && $1 =~ ^(feat|fix|test|chore|docs)\(pw-c\):\ [[:print:]]+$ ]]
}
audit_staged() {
  local path
  while IFS= read -r path; do allowed "$path"; done < <(g diff --cached --name-only)
  g diff --cached --numstat | stats
}
audit() {
  local commit path
  g merge-base --is-ancestor "$BASE" HEAD
  for commit in $(g rev-list --reverse "$BASE..HEAD"); do
    subject "$(g show -s --format=%B "$commit")"
    g show --format= --numstat "$commit" | stats
    g show -s --format='%H %s' "$commit"
  done
  while IFS= read -r path; do allowed "$path"; done < <(g diff --name-only "$BASE" HEAD)
  g diff --quiet HEAD -- api/src/artifacts api/tests/integration/pw-write-authority-rights.spec.ts tools/make/base-api-pwc* ui/nginx/default.conf deploy/k8s/nginx/default.conf plan/PWC-BRANCH_feat-api-paniers-pwc.md
  g diff --quiet "$BASE" HEAD -- api/src/artifacts/write-intent-transaction.ts
}
case ${1:-} in
  stage)
    read -r -a paths <<< "${FILES:?}"
    for path in "${paths[@]}"; do allowed "$path"; done
    g add -- "${paths[@]}"
    audit_staged;;
  commit)
    audit_staged
    subject "${MSG:?}"
    g -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -m "$MSG"
    subject "$(g show -s --format=%B HEAD)";;
  audit) audit;;
  bundle)
    audit
    mkdir -p tmp/pwc-evidence
    bundle=$ROOT/tmp/pwc-evidence/api-paniers-pwc-on-pwa-final.bundle
    [[ ! -L $bundle ]]
    g bundle create "$bundle" "$BASE..HEAD"
    audit_repo=$(mktemp -d "$ROOT/tmp/pwc-evidence/bundle-audit.XXXXXX")
    git init --bare -q "$audit_repo"
    git -C "$audit_repo" fetch --no-tags --no-write-fetch-head "$ROOT" "$BASE:refs/heads/prerequisite"
    git -C "$audit_repo" symbolic-ref HEAD refs/heads/prerequisite
    head=$(g rev-parse HEAD)
    if git -C "$audit_repo" cat-file -e "$head^{commit}" 2>/dev/null; then
      echo 'Payload already present before bundle import' >&2; exit 2
    fi
    git -C "$audit_repo" bundle verify "$bundle"
    git -C "$audit_repo" fetch --no-tags --no-write-fetch-head "$bundle" HEAD:refs/heads/payload
    git -C "$audit_repo" symbolic-ref HEAD refs/heads/payload
    [[ $(git -C "$audit_repo" rev-parse HEAD) == "$head" ]]
    [[ $(git -C "$audit_repo" rev-parse 'HEAD^{tree}') == $(g rev-parse 'HEAD^{tree}') ]]
    git -C "$audit_repo" fsck --full --no-reflogs
    printf 'BASE=%s\nHEAD=%s\nAUDIT=%s\n' "$BASE" "$head" "$audit_repo"
    sha256sum "$bundle" | tee "$bundle.sha256";;
  *) exit 2;;
esac
