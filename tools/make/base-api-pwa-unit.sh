#!/usr/bin/env bash
# Explicit review instruction: isolated host unit tests while Docker is reserved.
set -euo pipefail
[[ $ENV == test-api-paniers-pwa ]]
ROOT=$(pwd -P)
UNIT=$ROOT/tmp/pwa-evidence/unit
mkdir -p "$UNIT" "$ROOT/tmp/pwa-evidence/astra"
if [[ ! -x $UNIT/node_modules/.bin/vitest ]]; then
  tar -xf tmp/pwa-evidence/runtime/source.tar -C "$UNIT"
  (cd "$UNIT"; npm ci --cache "$ROOT/tmp/pwa-evidence/unit-cache" --ignore-scripts --no-audit --no-fund \
    > "$ROOT/tmp/pwa-evidence/astra/unit-install.log" 2>&1)
fi
cp api/src/artifacts/write-* "$UNIT/api/src/artifacts/"
cat > "$UNIT/api/vitest.review.config.ts" <<'CONFIG'
import config from './vitest.config.js';
export default { ...config, envDir: false,
  test: { ...config.test, fileParallelism: false, maxWorkers: 1 } };
CONFIG
cd "$UNIT/api"
../node_modules/.bin/vitest run --config vitest.review.config.ts \
  --reporter=default --reporter=json \
  --outputFile.json="$ROOT/tmp/pwa-evidence/astra/unit-tests.json" ${SCOPE:-src/artifacts/write-*.test.ts}
