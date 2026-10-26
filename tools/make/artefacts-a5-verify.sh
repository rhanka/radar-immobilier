#!/usr/bin/env bash
set -euo pipefail
case ${1:?} in
  qualify-astra)
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run db:migrate --workspace=api && npm run typecheck --workspaces --if-present && npx eslint . --ignore-pattern "tmp/**" && node tools/make/artefacts-a5-astra-mutations.mjs && ARTIFACTS_PROVIDER_ACCEPTANCE=1 npm run test --workspace=api -- tests/integration/artifacts-provider-acceptance.spec.ts tests/integration/artifacts-finalization-authorization.spec.ts tests/integration/artifacts-provider-failures.spec.ts --maxWorkers=1 --reporter=json --outputFile=/evidence/provider-results.json && npm run test --workspace=api -- --maxWorkers=1 --reporter=json --outputFile=/evidence/api-results.json && npm run test --workspace=packages/immo-mcp -- --exclude "**/*.e2e.test.ts" --maxWorkers=1 --reporter=json --outputFile=/evidence/mcp-results.json && npm run test --workspace=packages/artifacts-host -- --maxWorkers=1 --reporter=json --outputFile=/evidence/host-results.json && node --test tools/security/*.test.mjs && node tools/security/audit-gate.mjs && npm run build --workspace=api && node tools/make/artefacts-a4-mutations.mjs && node tools/make/artefacts-a5-tuple.mjs && npx tsx tools/make/artefacts-a5-profile-proof.ts' ;;
  test-astra-compatibility)
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run test --workspace=api -- tests/integration/artifacts-control.spec.ts tests/integration/artifacts-locks.spec.ts tests/integration/artifacts-mcp-adapter.spec.ts tests/integration/artifacts-publication.spec.ts tests/integration/artifacts-commit-probe.spec.ts tests/integration/artifacts-s3-body-timeout.spec.ts src/artifacts/control-route-commit.test.ts src/artifacts/control-cache.test.ts --maxWorkers=1 --reporter=json --outputFile=/evidence/compatibility-results.json' ;;
  test-astra)
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run test --workspace=api -- tests/integration/artifacts-astra-a5-mcp-admission.spec.ts tests/integration/artifacts-astra-a5-finalization.spec.ts tests/integration/artifacts-astra-a5-pool-guard.spec.ts tests/integration/artifacts-astra-a5-http-admission.spec.ts --maxWorkers=1 --reporter=json --outputFile=/evidence/astra-results.json' ;;
  test-astra-mutations)
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && node tools/make/artefacts-a5-astra-mutations.mjs' ;;
  verify)
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run test --workspace=packages/immo-mcp -- --exclude "**/*.e2e.test.ts" --maxWorkers=1 --reporter=json --outputFile=/evidence/mcp-results.json && npm run test --workspace=packages/artifacts-host -- --maxWorkers=1 --reporter=json --outputFile=/evidence/host-results.json && npm run typecheck --workspaces --if-present && npx eslint . --ignore-pattern "tmp/**" && node --test tools/security/*.test.mjs && node tools/security/audit-gate.mjs && npm run build --workspace=api && node tools/make/artefacts-a4-mutations.mjs && node tools/make/artefacts-a5-tuple.mjs && npx tsx tools/make/artefacts-a5-profile-proof.ts' ;;
  test-api-ci)
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run db:migrate --workspace=api && npm run test --workspace=api -- --maxWorkers=1 --reporter=json --outputFile=/evidence/api-results.json' ;;
  inspect-profile)
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npx tsx tools/make/artefacts-a5-profile-proof.ts && node tools/make/artefacts-a5-tuple.mjs' ;;
  test-composition-contract)
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run test --workspace=packages/immo-mcp -- src/registry/artifact-provider.test.ts src/registry/artifact-binding.test.ts src/artifacts-composition.test.ts src/stateful-composition.test.ts src/stateful-host.test.ts --maxWorkers=1 --reporter=json --outputFile=/evidence/composition-results.json' ;;
  diagnose-provider|test-provider)
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npm run db:migrate --workspace=api && ARTIFACTS_PROVIDER_ACCEPTANCE=1 npm run test --workspace=api -- tests/integration/artifacts-provider-acceptance.spec.ts tests/integration/artifacts-finalization-authorization.spec.ts tests/integration/artifacts-provider-failures.spec.ts --maxWorkers=1 --reporter=json --outputFile=/evidence/provider-results.json' ;;
  migration-proof)
    export A5_SERVICES=1
    export CMD='npm ci --strict-peer-deps --ignore-scripts && npx tsx tools/make/artefacts-a5-migration-proof.ts' ;;
  test-runtime)
    export A5_IMAGE=1 A5_BUILD_IMAGE=1 A5_SERVICES=1 CMD='actual sixteen-tool runtime with PostgreSQL and S3' ;;
  *) exit 2 ;;
esac
exec bash tools/make/artefacts-a5-run.sh
