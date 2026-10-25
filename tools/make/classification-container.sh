#!/usr/bin/env bash
set -euo pipefail
mode=$1
scope=$2
case $mode in
  targeted) action=test-api;;
  qualify) action=ci-api;;
  types) action=typecheck;;
  *) exit 2;;
esac
bash tools/make/base-api-container.sh "$action" "$scope"
cat > api/tsconfig.classification-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/classification-*.ts"],"exclude":["dist","node_modules"]}
CONFIG
node_modules/.bin/tsc --noEmit -p api/tsconfig.classification-tests.json
node_modules/.bin/eslint api/src/services/facets/classification-*.ts api/src/routes/scoped-classification.ts api/tests/integration/classification-*.ts
if [[ $mode == qualify ]]; then
  node tools/make/classification-mutants.mjs
fi
