#!/usr/bin/env bash
set -euo pipefail
cd /workspace
# Reuse the established installer, synthetic DB bootstrap and scoped runner.
bash tools/make/base-api-container.sh test-api "$1"
cp /evidence/tests.json /evidence/scoped-tests.json
cp /evidence/tests.tsv /evidence/scoped-tests.tsv
npm run typecheck --workspace=api
cat > api/tsconfig.pwb-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/base-api*.ts"],"exclude":["dist","node_modules"]}
CONFIG
node_modules/.bin/tsc --noEmit -p api/tsconfig.pwb-tests.json
node_modules/.bin/eslint api tools/make/base-api-pwb*.mjs
for file in tools/make/base-api-pwb*.sh; do bash -n "$file"; done
npm run build --workspace=api
bash tools/make/base-api-pwb-mutation.sh
# Same npm script, Vitest include and exclude patterns as the CI API workspace.
# Only worker concurrency and dotenv discovery differ for isolation.
npm run test --workspace=api -- --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/ci-tests.json
node tools/make/base-api-results.mjs /evidence/ci-tests.json > /evidence/ci-tests.tsv
