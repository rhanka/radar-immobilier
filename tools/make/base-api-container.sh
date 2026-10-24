#!/usr/bin/env bash
set -euo pipefail
action=$1; scope=$2
tar -xf /source.tar -C /workspace
cd /workspace
# Disable every lifecycle hook; only the known JS binary installer is run.
npm ci --ignore-scripts --no-audit --no-fund > /evidence/install.log 2>&1
node node_modules/esbuild/install.js >> /evidence/install.log 2>&1
cat > api/vitest.isolated.config.ts <<'CONFIG'
import config from './vitest.config.js';
export default { ...config, envDir: false,
  test: { ...config.test, fileParallelism: false, maxWorkers: 1 } };
CONFIG
# Avoid repeated container DNS lookups consuming the API's 3s connect budget.
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
typecheck_api() {
  node --check tools/make/base-api-required-mutations.mjs
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
  node_modules/.bin/eslint -- api/src/scripts/base-api-personal-activation.ts
  local tests=(api/tests/integration/base-api*.ts)
  node_modules/.bin/eslint api/src/services/facets api/src/routes/scoped-*.ts api/src/routes/workspaces.ts api/src/routes/graph-signals.ts api/src/routes/signal-facets.ts api/src/app.ts api/src/index.ts api/src/db/schema.ts api/src/routes/chat.ts api/src/routes/prospect-marks*.ts api/src/services/chat/stream-bus*.ts "${tests[@]}"
  local file
  while IFS= read -r file; do
    [[ -n $file ]] || continue
    printf 'CHANGED_FILE_LINT %s\n' "$file"
    node_modules/.bin/eslint -- "$file"
  done < /evidence/changed-files.txt
}
case $action in
  network-proof) node tools/make/base-api-network.mjs;;
  typecheck) typecheck_api;;
  lint) lint_api;;
  verify|ci-api|test|test-api|b1-mutation-legacy|b1-mutation-archive|b1-mutation-required|b3-mutation-required|b4-mutation-required)
    if [[ $action == verify || $action == ci-api || $action == *-mutation-* ]]; then
      typecheck_api
      lint_api
    fi
    cd api
    node ../tools/make/base-api-ct8.mjs | tee /evidence/ct8.log
    node ../tools/make/base-api-b2-setup.mjs
    if [[ $action == ci-api ]]; then
      cd /workspace
      npm run build --workspace=api
      test -s api/dist/index.d.ts
      cd api
    fi
    if [[ $action == verify && -f src/services/facets/lots/lot-cutover-journal-db.test.ts ]]; then
      node ../tools/make/base-api-ct7-proof.mjs | tee /evidence/ct7.log
    fi
    set -f
    if [[ $action == *-mutation-* ]]; then
      timeout --signal=TERM --kill-after=5 600 bash "../tools/make/base-api-${action%%-*}-mutation.sh" "${action#*-mutation-}"
      if [[ $action == b3-* || $action == b4-* ]]; then node ../tools/make/base-api-required-mutations.mjs "${action%%-*}"; fi
    else
    if [[ $action == ci-api ]]; then
      npm run test --workspace=api -- --config vitest.isolated.config.ts \
        --reporter=default --reporter=json --outputFile.json=/evidence/tests.json
    else
      ../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
        --reporter=default --reporter=json --outputFile.json=/evidence/tests.json $scope
    fi
    fi
    node ../tools/make/base-api-results.mjs /evidence/tests.json > /evidence/tests.tsv;;
  *) exit 2;;
esac
