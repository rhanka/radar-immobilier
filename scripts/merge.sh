#!/usr/bin/env bash
# Gated merge — the ONLY sanctioned way to merge a PR. Chains the authoritative
# gate → `gh pr merge`, so the gate is inseparable from the merge (you cannot
# forget to run it). Merges ONLY if scripts/gate.sh passes (exit 0).
#
#   usage: bash scripts/merge.sh <pr-number> [--delete-branch]
set -uo pipefail
PR="${1:?usage: merge.sh <pr-number> [--delete-branch]}"; shift || true
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! bash "$HERE/gate.sh" "$PR"; then
  echo "[merge] ABORTED — gate BLOCKED PR #$PR (not merged)"
  exit 1
fi
echo "[merge] gate PASS → merging PR #$PR"
gh pr merge "$PR" --merge "$@"
