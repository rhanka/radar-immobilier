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
cat > api/tsconfig.pwe-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/pwe-*.ts"],"exclude":["dist","node_modules"]}
CONFIG
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
export PWE_REQUIRED_SCOPE="$2"
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
  api/src/artifacts/pwe-*.ts tools/make/base-api-pwe*.mjs)
check eslint node_modules/.bin/eslint "${lint[@]}"
node tools/make/base-api-ct8.mjs > /evidence/ct8.log
node tools/make/base-api-b2-setup.mjs > /evidence/db-setup.log
cd api
read -r -a scopes <<< "${2//$'\n'/ }"
check required ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "${scopes[@]}" \
  --reporter=default --reporter=json --outputFile.json=/evidence/required.json
if [[ $1 == full ]]; then
  check build npm run build
  check full npm test -- --config vitest.isolated.config.ts \
    --reporter=default --reporter=json --outputFile.json=/evidence/full.json
fi
check results node ../tools/make/base-api-pwe-results.mjs
exit "$overall"
