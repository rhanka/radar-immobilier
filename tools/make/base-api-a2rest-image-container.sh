#!/usr/bin/env bash
# No source/dependency bind mounts or installation: these bytes belong to the image.
set -euo pipefail
cd /workspace
POSTGRES_HOST=$(node --input-type=module -e 'import {lookup} from "node:dns/promises"; console.log((await lookup("postgres", {family:4})).address)')
export POSTGRES_HOST
cd api
scope=tests/integration/mcp-signal-search-network.e2e.spec.ts
../node_modules/.bin/vitest run --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/image-tests.json "$scope"
node ../tools/make/base-api-results.mjs /evidence/image-tests.json > /evidence/image-tests.tsv
