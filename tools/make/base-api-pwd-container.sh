#!/usr/bin/env bash
set -euo pipefail
cd /workspace
bash tools/make/base-api-container.sh test-api "$1"
cp /evidence/tests.json /evidence/scoped-tests.json
cp /evidence/tests.tsv /evidence/scoped-tests.tsv
npm run typecheck --workspaces --if-present
cat > api/tsconfig.pwd-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/pw-write*.ts"],"exclude":["dist","node_modules"]}
CONFIG
node_modules/.bin/tsc --noEmit -p api/tsconfig.pwd-tests.json
node_modules/.bin/eslint .
npm run build --workspace=api
npm run test --workspace=api -- --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/ci-tests.json
node tools/make/base-api-results.mjs /evidence/ci-tests.json > /evidence/ci-tests.tsv
if [[ -f tools/make/base-api-pwd-mutations.mjs ]]; then
  node tools/make/base-api-pwd-mutations.mjs
fi
