#!/usr/bin/env bash
# Synthetic container execution only. No environment-file discovery.
set -euo pipefail
mode=$1; scope=$2; mcp_scope=$3
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
cat > packages/immo-mcp/vitest.isolated.config.ts <<'CONFIG'
export default { envDir: false, test: {
  include: ["src/**/*.test.ts"], exclude: ["**/*.e2e.test.ts"],
  fileParallelism: false, maxWorkers: 1 } };
CONFIG
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
if [[ $mode == check ]]; then
  npm run typecheck --workspace=api
  npm run typecheck --workspace=packages/immo-mcp
  cat > api/tsconfig.a2mcp-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/a2base-mcp*.ts"],"exclude":["dist","node_modules"]}
CONFIG
  node_modules/.bin/tsc --noEmit -p api/tsconfig.a2mcp-tests.json
  node_modules/.bin/eslint packages/immo-mcp/src api/src/artifacts/strict-receiver*.ts \
    api/src/config.ts api/src/config.test.ts api/src/routes/auth.ts api/src/routes/auth.test.ts \
    api/tests/integration/a2base-mcp*.ts tools/make/base-api-a2mcp*.mjs
  for file in tools/make/base-api-a2mcp*.sh; do bash -n "$file"; done
  for file in tools/make/base-api-a2mcp*.mjs; do node --check "$file"; done
  exit
fi
cd api
node ../tools/make/base-api-ct8.mjs > /evidence/ct8.log
node ../tools/make/base-api-b2-setup.mjs
set -f
../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/tests.json $scope
node ../tools/make/base-api-results.mjs /evidence/tests.json > /evidence/tests.tsv
cd ../packages/immo-mcp
../../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/mcp-tests.json $mcp_scope
node ../../tools/make/base-api-results.mjs /evidence/mcp-tests.json | sed 's|^/workspace/packages/immo-mcp/||' > /evidence/mcp-tests.tsv
cd /workspace
if [[ $mode == mutations ]]; then node tools/make/base-api-a2mcp-mutants.mjs; fi
