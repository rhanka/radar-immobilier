#!/usr/bin/env bash
set -euo pipefail
source tools/make/base-api-pwa-offline-container.sh
npm ci --ignore-scripts --no-audit --no-fund > /evidence/install.log 2>&1
node node_modules/esbuild/install.js >> /evidence/install.log 2>&1
# Browser setup is separate from the application runtime image under test.
node_modules/.bin/playwright install --with-deps --only-shell chromium > /evidence/browser-install.log 2>&1
cat > api/vitest.image.config.ts <<'CONFIG'
import config from './vitest.config.js';
export default {...config,envDir:false,test:{...config.test,
  include:['tests/integration/l5-images.acceptance.ts'],fileParallelism:false,maxWorkers:1}};
CONFIG
cd api
../node_modules/.bin/vitest run --config vitest.image.config.ts --reporter=default \
  --reporter=json --outputFile.json=/evidence/browser.json
