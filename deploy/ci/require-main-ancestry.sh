#!/usr/bin/env bash
# Refuses a version-tag run whose commit is not on main history (G0 v3 §5 P7,
# #1012 review E2): an arbitrary `v*` tag placed on an artifact commit must
# never deploy. Same check as promote-prod. Run right after actions/checkout,
# before any secret or lock. Inputs: GITHUB_REF, GITHUB_SHA (set by Actions).
set -euo pipefail
ref=${GITHUB_REF:?GITHUB_REF unset}
sha=${GITHUB_SHA:?GITHUB_SHA unset}
case $ref in
  refs/heads/main) echo "[main-ancestry] main"; exit 0 ;;
  refs/tags/*) ;;
  *) echo "::error::[main-ancestry] ref $ref refused: only main or a version tag on main"; exit 1 ;;
esac
if [[ $(git rev-parse --is-shallow-repository) == true ]]; then
  git fetch --no-tags --quiet --unshallow origin main
else
  git fetch --no-tags --quiet origin main
fi
if ! git merge-base --is-ancestor "$sha" FETCH_HEAD; then
  echo "::error::[main-ancestry] tag $ref ($sha) is not on main history; refused"
  exit 1
fi
echo "[main-ancestry] tag $ref ($sha) is on main history"
