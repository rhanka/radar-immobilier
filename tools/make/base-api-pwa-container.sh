#!/usr/bin/env bash
set -euo pipefail
cd /workspace
bash tools/make/base-api-container.sh test-api "$1"
cp /evidence/tests.json /evidence/scoped-tests.json
cp /evidence/tests.tsv /evidence/scoped-tests.tsv
npm run typecheck --workspace=api
npm run typecheck --workspace=packages/artifacts-host --workspace=packages/immo-mcp
cat > api/tsconfig.pwa-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/pw-write-authority*.ts"],"exclude":["dist","node_modules"]}
CONFIG
node_modules/.bin/tsc --noEmit -p api/tsconfig.pwa-tests.json
node_modules/.bin/eslint .
for file in tools/make/base-api-pwa*.sh; do bash -n "$file"; done
npm run build --workspace=api
if [[ -f tools/make/base-api-pwa-mutations.mjs ]]; then node tools/make/base-api-pwa-mutations.mjs; fi
npm run test --workspace=api -- --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/ci-tests.json
node tools/make/base-api-results.mjs /evidence/ci-tests.json > /evidence/ci-tests.tsv
mkdir -p tmp
printf '%s\n' 'export default { envDir: false, test: { maxWorkers: 1, fileParallelism: false } };' > tmp/pwa-packages.config.mjs
for package in artifacts-host immo-mcp; do
  (cd "packages/$package"; ../../node_modules/.bin/vitest run --config /workspace/tmp/pwa-packages.config.mjs \
    --exclude '**/*.e2e.test.ts' --reporter=default --reporter=json \
    --outputFile.json="/evidence/$package-tests.json")
done
