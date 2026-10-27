#!/usr/bin/env bash
# The owner requested migration/static/PostgreSQL gates, with optional CI.
set -euo pipefail
[[ ${2:-1} == 0 || ${2:-1} == 1 ]]
printf '%s\n' "${2:-1}" > /evidence/ci-requested.txt
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
printf '%s\n' 'PASS migration and static gates' > /evidence/sequence-static-result
if [[ ${2:-1} == 1 ]]; then
  npm run test --workspace=api -- --config vitest.isolated.config.ts \
    --reporter=default --reporter=json --outputFile.json=/evidence/ci-tests.json
  node tools/make/base-api-results.mjs /evidence/ci-tests.json > /evidence/ci-tests.tsv
fi
