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
overall=0
check() {
  local label=$1; shift
  set +e
  "$@" > "/evidence/$label.log" 2>&1
  local code=$?
  set -e
  printf '%s\t%s\n' "$label" "$code" | tee -a /evidence/results.tsv
  tail -n 20 "/evidence/$label.log"
  [[ $code == 0 ]] || overall=1
}
check typecheck npm run typecheck --workspace=api
check eslint bash -ec 'node_modules/.bin/eslint api/src/artifacts/write-intent-*.ts api/src/artifacts/content-serve*.ts tools/make/base-api-pwc*.mjs'
check build npm run build --workspace=api
check nginx bash deploy/k8s/nginx/check-header-parity.sh
check nginx-proxy node tools/make/base-api-pwc-nginx.mjs
cd api
node ../tools/make/base-api-ct8.mjs > /evidence/ct8.log
node ../tools/make/base-api-b2-setup.mjs > /evidence/db-setup.log
check unit ../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
  src/artifacts/write-intent-page.test.ts src/artifacts/write-intent-page-poll.test.ts \
  src/artifacts/write-intent-page-listener.test.ts src/artifacts/write-intent-app-page.test.ts \
  src/artifacts/content-serve.test.ts src/artifacts/write-intent-app-script.test.ts \
  src/artifacts/write-intent-page-regressions.test.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/unit.json
check postgres ../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
  src/artifacts/write-intent-app-surface-db.test.ts src/artifacts/write-intent-app-rights-db.test.ts \
  src/artifacts/write-intent-app-invariants-db.test.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/postgres.json
if [[ $1 == final ]]; then
  check full npm test -- --config vitest.isolated.config.ts \
    --reporter=default --reporter=json --outputFile.json=/evidence/full.json
fi
if [[ $1 == mutations || $1 == final ]]; then
  check mutations node ../tools/make/base-api-pwc-mutations.mjs
fi
check results node ../tools/make/base-api-pwc-results.mjs
exit "$overall"
