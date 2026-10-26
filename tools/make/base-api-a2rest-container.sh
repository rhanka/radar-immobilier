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
if [[ $mode == check || $mode == mutations || $mode == image || $mode == qualify ]]; then
  npm run typecheck --workspace=api
  npm run typecheck --workspace=packages/immo-mcp
  cat > api/tsconfig.a2rest-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/mcp-signal-search*.ts","tests/integration/a2base-mcp*.ts"],"exclude":["dist","node_modules"]}
CONFIG
  node_modules/.bin/tsc --noEmit -p api/tsconfig.a2rest-tests.json
  node_modules/.bin/eslint api/src/app.ts api/src/routes/graph-signals.ts api/src/routes/mcp-signal-search*.ts \
    api/src/services/facets/scope.ts packages/immo-mcp/src/signal-read-error{,.test}.ts \
    api/src/services/graph/regulatory-status-archi.test.ts \
    api/src/services/facets/mcp-signal-*.ts api/tests/integration/mcp-signal-search*.ts \
    api/tests/integration/a2base-mcp-fixture.ts tools/make/base-api-a2rest*.mjs
  for file in tools/make/base-api-a2rest*.sh; do bash -n "$file"; done
  for file in tools/make/base-api-a2rest*.mjs; do [[ ! -f $file ]] || node --check "$file"; done
  [[ $mode != check ]] || exit 0
fi
cd api
node ../tools/make/base-api-ct8.mjs > /evidence/ct8.log
node ../tools/make/base-api-b2-setup.mjs
set -f
../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/tests.json $scope
node ../tools/make/base-api-results.mjs /evidence/tests.json > /evidence/tests.tsv
if [[ $mode == qualify ]]; then
  # Identical API npm test entrypoint and collection as CI, serialized for this host.
  (cd /workspace; npm run test --workspace=api -- --config vitest.isolated.config.ts \
    --reporter=default --reporter=json --outputFile.json=/evidence/ci-api-tests.json)
  node ../tools/make/base-api-results.mjs /evidence/ci-api-tests.json > /evidence/ci-api-tests.tsv
fi
cd ../packages/immo-mcp
../../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/mcp-tests.json $mcp_scope
node ../../tools/make/base-api-results.mjs /evidence/mcp-tests.json | sed 's|^/workspace/packages/immo-mcp/||' > /evidence/mcp-tests.tsv
cd /workspace
if [[ $mode == mutations || $mode == qualify ]]; then node tools/make/base-api-a2rest-mutants.mjs; fi
if [[ $mode == image || $mode == qualify ]]; then
  npm run build --workspace=api
  node tools/make/base-api-a2rest-image.mjs
  tar -cf /evidence/runtime.tar --exclude=./tmp --exclude=./.git .
fi
