#!/bin/sh
set -eu
npm ci --cache /tmp/immo-p0c-npm
npm run typecheck --workspace=packages/immo-mcp
npm run typecheck --workspace=packages/artifacts-host
npm run typecheck --workspace=api
npx --no-install tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --esModuleInterop --skipLibCheck packages/immo-mcp/scripts/p0c-switch.ts
npx --no-install eslint packages/immo-mcp/src packages/artifacts-host/src api/src/artifacts/control-route*.ts
npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts'
npm run test --workspace=packages/artifacts-host -- --maxWorkers=1
ARTIFACTS_PROFILE_REVISION=immo-artifacts.cas.v2 npm run test --workspace=packages/immo-mcp -- src/registry/p0c-transport.test.ts src/registry/p0c-http.test.ts --maxWorkers=1
ARTIFACTS_PROFILE_REVISION=immo-artifacts.v2 ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true \
  npm run test --workspace=packages/immo-mcp -- src/registry/p0c-transport.test.ts src/registry/p0c-http.test.ts --maxWorkers=1
