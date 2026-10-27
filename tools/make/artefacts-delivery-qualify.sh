#!/usr/bin/env bash
set -euo pipefail
# Keep the earlier 615 DB-gated tests and all new startup/probe cases enabled.
export CMD='
apt-get update > /evidence/apt.log 2>&1
apt-get install -y --no-install-recommends curl jq >> /evidence/apt.log 2>&1
npm ci --strict-peer-deps --ignore-scripts > /evidence/install.log 2>&1
export LOT_MIGRATION_DB_TEST=1
export DELIVERY_PROBE_EVIDENCE_DIR=/evidence/probe
npm run db:migrate --workspace=api
node tools/make/artefacts-delivery-manifests.mjs
npm run typecheck --workspaces --if-present > /evidence/typecheck.log 2>&1
npx eslint . --ignore-pattern "tmp/**" > /evidence/lint.log 2>&1
npm run test --workspace=api -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=/evidence/api-ci.json > /evidence/api-ci.log 2>&1
ARTIFACTS_PROVIDER_ACCEPTANCE=1 npm run test --workspace=api -- tests/integration/artifacts-provider-acceptance.spec.ts tests/integration/artifacts-finalization-authorization.spec.ts tests/integration/artifacts-provider-failures.spec.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=/evidence/provider.json > /evidence/provider.log 2>&1
npm run test --workspace=packages/immo-mcp -- --exclude "**/*.e2e.test.ts" --maxWorkers=1 --reporter=default --reporter=json --outputFile=/evidence/mcp.json > /evidence/mcp.log 2>&1
node tools/make/artefacts-delivery-results.mjs
'
exec bash tools/make/artefacts-delivery-run.sh
