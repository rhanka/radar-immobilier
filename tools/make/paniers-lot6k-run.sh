#!/usr/bin/env bash
# 6K versioned test launcher (BR6K-EX2).
# Records RUNNER_VERSION plus a sha256 manifest of every file the 6K tests
# read, then delegates to the isolated verifier. ENV stays the last
# argument; no host ports are published.
set -euo pipefail
RUNNER_VERSION="6K-3"
case "${ENV:-}" in test-*|e2e-*) ;; *) echo 'test-* or e2e-* ENV required' >&2; exit 2;; esac
test "${LOT:-}" = 6K
task_dir="$PWD/tmp/paniers-6k"
mkdir -p "$task_dir"
export RUNNER_VERSION
exec bash tools/make/paniers-lot6-verify.sh "$@"
