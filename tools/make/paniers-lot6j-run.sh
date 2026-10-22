#!/usr/bin/env bash
# 6J versioned test launcher (BR6J-EX2).
# Records RUNNER_VERSION plus a sha256 manifest of every file the 6J tests
# read, then delegates to the isolated verifier. ENV stays the last
# argument; no host ports are published.
set -euo pipefail
RUNNER_VERSION="6J-2"
case "${ENV:-}" in test-*|e2e-*) ;; *) echo 'test-* or e2e-* ENV required' >&2; exit 2;; esac
test "${LOT:-}" = 6J
task_dir="$PWD/tmp/paniers-6j"
mkdir -p "$task_dir"
export RUNNER_VERSION
exec bash tools/make/paniers-lot6-verify.sh "$@"
