#!/usr/bin/env bash
set -euo pipefail
source tools/make/base-api-pwa-offline-container.sh
printf '#!/bin/bash\nexec /pwa-tools/lib64/ld-linux-x86-64.so.2 --library-path /pwa-tools/usr/lib/x86_64-linux-gnu:/pwa-tools/lib/x86_64-linux-gnu /pwa-tools/usr/bin/openssl "$@"\n' > /pwa-bin/openssl
chmod 755 /pwa-bin/openssl
export OPENSSL_CONF=/dev/null
openssl version >> /evidence/system-package-versions.txt
npm ci --ignore-scripts --no-audit --no-fund > /evidence/install.log 2>&1
node node_modules/esbuild/install.js >> /evidence/install.log 2>&1
# Browser setup is separate from the application runtime image under test.
node_modules/.bin/playwright install --with-deps --only-shell chromium > /evidence/browser-install.log 2>&1
cat > api/vitest.image.config.ts <<'CONFIG'
import config from './vitest.config.js';
export default {...config,envDir:false,test:{...config.test,
  include:['tests/integration/l5-images.acceptance.ts',
    ...(process.env.L5_CONTENT_BASE==='pages.sent-tech.ca'?['tests/integration/artifacts-baskets-browser.spec.ts']:[])],
  fileParallelism:false,maxWorkers:1}};
CONFIG
export ARTIFACTS_BROWSER_ACCEPTANCE=1
cd api
../node_modules/.bin/vitest run --config vitest.image.config.ts --reporter=default \
  --reporter=json --outputFile.json=/evidence/browser.json
