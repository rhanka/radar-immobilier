#!/usr/bin/env bash
set -euo pipefail
case ${1:?} in
  verify)
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run test --workspace=packages/immo-mcp -- --exclude "**/*.e2e.test.ts" --maxWorkers=1 --reporter=json --outputFile=/evidence/mcp-results.json && npm run test --workspace=packages/artifacts-host -- --maxWorkers=1 --reporter=json --outputFile=/evidence/host-results.json && npm run typecheck --workspaces --if-present && npx eslint . --ignore-pattern "tmp/**" && node --test tools/security/*.test.mjs && node tools/security/audit-gate.mjs && npm run build --workspace=api && node tools/make/artefacts-a4-mutations.mjs && node tools/make/artefacts-a4-tuple.mjs && npx tsx tools/make/artefacts-a5-profile-proof.ts' ;;
  test-api-ci)
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run db:migrate --workspace=api && npm run test --workspace=api -- --maxWorkers=1 --reporter=json --outputFile=/evidence/api-results.json' ;;
  inspect-profile)
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npx tsx tools/make/artefacts-a5-profile-proof.ts && node tools/make/artefacts-a4-tuple.mjs' ;;
  test-composition-contract)
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run test --workspace=packages/immo-mcp -- src/registry/artifact-provider.test.ts src/registry/artifact-binding.test.ts src/artifacts-composition.test.ts src/stateful-composition.test.ts src/stateful-host.test.ts --maxWorkers=1 --reporter=json --outputFile=/evidence/composition-results.json' ;;
  diagnose-provider)
    # Diagnostic adoption is container-local; never copy its manifests/lockfile back.
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm install --workspace=api --workspace=packages/artifacts-host --save-exact --strict-peer-deps --ignore-scripts @sentropic/artifacts@0.2.0 && cp package-lock.json /evidence/diagnostic-package-lock.json && npm run db:migrate --workspace=api && ARTIFACTS_PROVIDER_ACCEPTANCE=1 timeout --signal=TERM --kill-after=10 180 npm run test --workspace=api -- tests/integration/artifacts-provider-acceptance.spec.ts tests/integration/artifacts-finalization-authorization.spec.ts tests/integration/artifacts-provider-failures.spec.ts --maxWorkers=1 --reporter=json --outputFile=/evidence/provider-results.json' ;;
  test-runtime)
    # Preserved production recovery composition: twelve tools until A1 is qualified.
    export A5_IMAGE=1 A5_SERVICES=1 CMD='actual twelve-tool runtime recovery probe' ;;
  *) exit 2 ;;
esac
exec bash tools/make/artefacts-a5-run.sh
