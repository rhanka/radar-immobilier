#!/usr/bin/env bash
# Reuse B0's install/typecheck, then prepare the retained shared-DB suite.
set -euo pipefail
scope=$1
bash tools/make/base-api-container.sh typecheck ''
if [[ ${2:-full} == 6l2* ]]; then exec node tools/make/base-api-b2-regression.mjs "$2"; fi
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
node_modules/.bin/eslint api/src/services/facets api/src/routes/scoped-*.ts \
  api/src/routes/workspaces.ts api/src/app.ts api/src/index.ts api/src/db/schema.ts \
  api/src/routes/chat.ts api/src/routes/prospect-marks*.ts api/src/services/chat/stream-bus*.ts
cd api
node ../tools/make/base-api-b2-setup.mjs
node ../tools/make/base-api-ct8.mjs | tee /evidence/ct8.log
node ../tools/make/base-api-ct7-proof.mjs | tee /evidence/ct7.log
set -f
../node_modules/.bin/vitest run --config vitest.isolated.config.ts --reporter=default \
  --reporter=json --outputFile.json=/evidence/tests.json $scope
node ../tools/make/base-api-results.mjs /evidence/tests.json > /evidence/tests.tsv
for mutant in opening receipt-single receipt-batch fingerprint atomicity public-readback \
  false-empty empty-epoch empty-coverage empty-roster; do
  node ../tools/make/base-api-b2-mutation-proof.mjs "$mutant"
done
cd /workspace
exec node tools/make/base-api-b2-regression.mjs
