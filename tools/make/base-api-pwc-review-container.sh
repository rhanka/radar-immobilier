#!/usr/bin/env bash
set -euo pipefail
cd /workspace
source tools/make/base-api-pwa-offline-container.sh
npm ci --ignore-scripts --no-audit --no-fund > /evidence/install.log 2>&1
node node_modules/esbuild/install.js >> /evidence/install.log 2>&1
cat > api/vitest.isolated.config.ts <<'CONFIG'
import config from './vitest.config.js';
export default { ...config, envDir: false,
  test: { ...config.test, fileParallelism: false, maxWorkers: 1 } };
CONFIG
if [[ $1 == proxy ]]; then
  cat >> api/vitest.isolated.config.ts <<'CONFIG'
// Select the acceptance module explicitly; ordinary API CI has no proxy dependency.
CONFIG
  sed -i "s/maxWorkers: 1/maxWorkers: 1, include: ['tests\/integration\/pwcr-proxy.acceptance.ts']/" api/vitest.isolated.config.ts
fi
cat > api/tsconfig.pwe-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/pwe-*.ts","tests/integration/pwcr-*.ts"],"exclude":["dist","node_modules"]}
CONFIG
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
export PWE_REQUIRED_SCOPE="$2"
export PWE_MUTATION_FILTER="${3:-.*}"
if [[ $1 == inherited ]]; then export PWCR_INHERITED_BATCH_FILTER="${3:-.*}"; fi
if [[ $1 == targeted ]]; then [[ -n ${3:-} ]]; fi
overall=0
check() {
  local label=$1; shift
  set +e
  "$@" > "/evidence/$label.log" 2>&1
  local code=$?
  set -e
  printf '%s\t%s\n' "$label" "$code" | tee -a /evidence/results.tsv
  tail -n 18 "/evidence/$label.log"
  [[ $code == 0 ]] || overall=1
}
check typecheck node_modules/.bin/tsc --noEmit -p api/tsconfig.pwe-tests.json
shopt -s nullglob
lint=(api/tests/integration/pwe-*.ts api/src/services/facets/pwe-*.ts
  api/tests/integration/pwcr-*.ts api/src/artifacts/write-intent-page-{read,surface,envelope,response,listener,authority}.ts
  api/src/artifacts/write-intent-app-{page,result}.ts api/src/artifacts/content-serve.ts tools/make/base-api-pwc-review*.mjs
  api/src/artifacts/write-intent-page{,-budget,-harness}.ts
  api/src/artifacts/write-intent-app-{route,authority,result,surface-db.test}.ts
  api/src/services/facets/signal-write-receipt.ts
  api/src/artifacts/pwe-*.ts tools/make/base-api-pwe*.mjs)
check eslint node_modules/.bin/eslint "${lint[@]}"
cd api
node ../tools/make/base-api-ct8.mjs > /evidence/ct8.log
node ../tools/make/base-api-b2-setup.mjs > /evidence/db-setup.log
read -r -a scopes <<< "${2//$'\n'/ }"
if [[ $1 == full ]]; then
  check app-result-regression node ../tools/make/base-api-pwe-app-result-regression.mjs
fi
check required ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "${scopes[@]}" \
  --reporter=default --reporter=json --outputFile.json=/evidence/required.json
if [[ $1 == full ]]; then
  check build npm run build
  check full npm test -- --config vitest.isolated.config.ts \
    --reporter=default --reporter=json --outputFile.json=/evidence/full.json
fi
if [[ $1 == full || $1 == mutations || $1 == inherited ]]; then
  check inherited-mutants node ../tools/make/base-api-pwc-review-inherited.mjs
fi
if [[ $1 == full || $1 == mutations || $1 == targeted ]]; then
  check pwe-mutants node ../tools/make/base-api-pwe-mutations.mjs
  check review-mutants node ../tools/make/base-api-pwc-review-mutations.mjs
fi
check results node ../tools/make/base-api-pwe-results.mjs
exit "$overall"
