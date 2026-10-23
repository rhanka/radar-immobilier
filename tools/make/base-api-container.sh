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
typecheck_api() {
  npm run typecheck --workspace=api
  if compgen -G 'api/tests/integration/base-api*.ts' > /dev/null; then
    cat > api/tsconfig.base-api-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/base-api*.ts"],"exclude":["dist","node_modules"]}
CONFIG
    node_modules/.bin/tsc --noEmit -p api/tsconfig.base-api-tests.json
  fi
}
lint_api() {
  shopt -s nullglob
  local tests=(api/tests/integration/base-api*.ts)
  node_modules/.bin/eslint api/src/services/facets api/src/routes/scoped-*.ts api/src/routes/workspaces.ts api/src/routes/graph-signals.ts api/src/routes/signal-facets.ts "${tests[@]}"
}
case $action in
  network-proof) node tools/make/base-api-network.mjs;;
  typecheck) typecheck_api;;
  lint) lint_api;;
  verify|test|test-api|b1-mutation-legacy|b1-mutation-archive)
    if [[ $action == verify || $action == b1-mutation-* ]]; then
      typecheck_api
      lint_api
    fi
    cd api
    node ../tools/make/base-api-ct8.mjs | tee /evidence/ct8.log
    npm run db:migrate
    set -f
    if [[ $action == b1-mutation-* ]]; then
      bash ../tools/make/base-api-b1-mutation.sh "${action#b1-mutation-}"
    else
    ../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
      --reporter=default --reporter=json --outputFile.json=/evidence/tests.json $scope
    fi
    node ../tools/make/base-api-results.mjs /evidence/tests.json > /evidence/tests.tsv;;
  *) exit 2;;
esac
