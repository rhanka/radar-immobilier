#!/usr/bin/env bash
set -euo pipefail
action=$1; scope=$2
tar -xf /source.tar -C /workspace
cd /workspace
# Supply the non-exercised geography import with an explicit synthetic fixture.
mkdir -p packages/radar-sources/src/geo
printf '[]\n' > packages/radar-sources/src/geo/municipalities.qc.json
# Disable every lifecycle hook; only the known JS binary installer is run.
npm ci --ignore-scripts --no-audit --no-fund > /evidence/install.log 2>&1
node node_modules/esbuild/install.js >> /evidence/install.log 2>&1
cat > api/vitest.isolated.config.ts <<'CONFIG'
import config from './vitest.config.js';
export default { ...config, envDir: false,
  test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };
CONFIG
# Avoid repeated container DNS lookups consuming the API's 3s connect budget.
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
case $action in
  network-proof) node tools/make/base-api-network.mjs;;
  typecheck) npm run typecheck --workspace=api;;
  lint) node_modules/.bin/eslint api/src/services/facets api/src/routes/scoped-*.ts api/src/routes/workspaces.ts;;
  verify|test|test-api)
    if [[ $action == verify ]]; then
      npm run typecheck --workspace=api
      node_modules/.bin/eslint api/src/services/facets api/src/routes/scoped-*.ts api/src/routes/workspaces.ts
    fi
    cd api
    node ../tools/make/base-api-ct8.mjs | tee /evidence/ct8.log
    set -f
    ../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
      --reporter=default --reporter=json --outputFile.json=/evidence/tests.json $scope
    node ../tools/make/base-api-results.mjs /evidence/tests.json > /evidence/tests.tsv;;
  *) exit 2;;
esac
