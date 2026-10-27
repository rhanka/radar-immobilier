#!/usr/bin/env bash
# Keep the shared worktree metadata read-only; resume from the delivered backup.
set -euo pipefail
[[ $ENV == test-base-preprod && ! -f $GIT_DIR/refs/heads/feat/base-preprod-operator ]]
base=c100e6cc0897bebc42c94157d8cb94f28348cab2
backup=$GIT_WORK_TREE/tmp/base-preprod-evidence/delivery/backup.eKabQW.git
[[ $(git --git-dir="$backup" rev-parse HEAD) == "$base" ]]
env -u GIT_WORK_TREE -u GIT_DIR git init --bare -q "$GIT_DIR"
git fetch --no-tags --no-write-fetch-head "$backup" "$base:refs/heads/feat/base-preprod-operator"
git symbolic-ref HEAD refs/heads/feat/base-preprod-operator
git read-tree HEAD
git fsck --full --no-reflogs
git status --short --branch
