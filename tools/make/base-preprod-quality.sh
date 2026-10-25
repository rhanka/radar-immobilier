#!/usr/bin/env bash
set -euo pipefail
cd /workspace
npm ci --ignore-scripts --no-audit --no-fund > /evidence/install.log 2>&1
node node_modules/esbuild/install.js >> /evidence/install.log 2>&1
cat > api/vitest.isolated.config.ts <<'CONFIG'
import config from './vitest.config.js';
export default { ...config, envDir: false,
  test: { ...config.test, fileParallelism: false, maxWorkers: 1 } };
CONFIG
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
npm run typecheck --workspaces --if-present
node_modules/.bin/eslint .
node --test --test-concurrency=1 tools/security/*.test.mjs
node tools/security/audit-gate.mjs
npm run db:migrate --workspace=api
npm run test --workspace=api -- --config vitest.isolated.config.ts --reporter=default --reporter=json --outputFile.json=/evidence/tests.json
node tools/make/base-api-results.mjs /evidence/tests.json > /evidence/tests.tsv
node -e 'const r=require("/evidence/tests.json"); if(r.numFailedTests||!r.numPassedTests) process.exit(1); console.log(JSON.stringify({passed:r.numPassedTests,failed:r.numFailedTests,skipped:r.numPendingTests}));'
