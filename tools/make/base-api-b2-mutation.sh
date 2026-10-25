#!/usr/bin/env bash
# Mutate only the B0 runner's disposable container copy, never the worktree.
set -euo pipefail
source "$(dirname -- "$0")/base-api-guards.sh"
require_env
exec bash "$(dirname -- "$0")/base-api-b2-regression.sh"
