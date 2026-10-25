#!/usr/bin/env bash
set -euo pipefail
mode=$1; scope=$2
cd /workspace
if [[ -d /download-cache ]]; then
  mkdir -p /tmp/npm-cache/_cacache
  cp -R /download-cache/. /tmp/npm-cache/_cacache/
fi
npm_config_cache=/tmp/npm-cache npm_config_prefer_offline=true \
  npm ci --ignore-scripts --no-audit --no-fund > /evidence/install.log 2>&1
node node_modules/esbuild/install.js >> /evidence/install.log 2>&1
cat > api/vitest.isolated.config.ts <<'CONFIG'
import config from './vitest.config.js';
export default { ...config, envDir: false,
  test: { ...config.test, fileParallelism: false, maxWorkers: 1 } };
CONFIG
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
if [[ $mode == check ]]; then
  npm run typecheck --workspace=api
  cat > api/tsconfig.a2base-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/mcp-signal-search*.ts"],"exclude":["dist","node_modules"]}
CONFIG
  node_modules/.bin/tsc --noEmit -p api/tsconfig.a2base-tests.json
  node_modules/.bin/eslint api/src/routes/mcp-signal-search*.ts api/src/routes/graph-signals.ts \
    api/src/services/facets/mcp-signal-*.ts api/tests/integration/mcp-signal-search*.ts
  for file in tools/make/base-api-a2base*.sh; do bash -n "$file"; done
  for file in tools/make/base-api-a2base*.mjs; do [[ ! -f $file ]] || node --check "$file"; done
  exit
fi
cd api
node ../tools/make/base-api-ct8.mjs > /evidence/ct8.log
node ../tools/make/base-api-b2-setup.mjs
set -f
../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/tests.json $scope
node ../tools/make/base-api-results.mjs /evidence/tests.json > /evidence/tests.tsv
if [[ $mode == mutations ]]; then node ../tools/make/base-api-a2base-mutants.mjs; fi
