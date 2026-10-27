#!/usr/bin/env bash
# Qualify the actual checkout, never the isolated delivery repository.
set -euo pipefail
unset GIT_DIR GIT_WORK_TREE
head=$(git rev-parse HEAD)
diff=$(git diff HEAD --no-ext-diff --binary | sha256sum | cut -d' ' -f1)
# Include untracked task sources, without reading environment files or evidence.
sources=$(git ls-files --cached --others --exclude-standard -- tools/make/base-preprod* tools/make/bascule-fix* \
  deploy/base-preprod deploy/ci/check-release-sha.test.sh deploy/ci/rollback-release* api/Dockerfile \
  .github/workflows/build-push-images.yml | sort -u | while IFS= read -r path; do sha256sum -- "$path"; done | sha256sum | cut -d' ' -f1)
jq -n --arg head "$head" --arg diff "$diff" --arg sources "$sources" \
  '{checkoutHead:$head,workingDiffSha256:$diff,sourceInventorySha256:$sources}'
