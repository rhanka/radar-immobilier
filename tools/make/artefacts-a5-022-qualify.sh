#!/usr/bin/env bash
set -uo pipefail
overall=0
check() {
  local label=$1 status
  shift
  printf '%q ' "$@" > "/evidence/$label.command"
  printf '\n' >> "/evidence/$label.command"
  "$@" > "/evidence/$label.log" 2>&1
  status=$?
  printf '%s\t%s\n' "$label" "$status" | tee -a /evidence/checks.tsv
  if [[ $status != 0 ]]; then overall=1; tail -n 80 "/evidence/$label.log"; fi
  return "$status"
}
check install npm ci --strict-peer-deps --ignore-scripts --no-audit --no-fund || exit 1
check tuple node tools/make/artefacts-a5-tuple.mjs
check profile npx tsx tools/make/artefacts-a5-profile-proof.ts
check typecheck npm run typecheck --workspaces --if-present
check lint npx eslint . --ignore-pattern 'tmp/**'
check api-unit npm run test --workspace=api -- --exclude 'tests/integration/**' --maxWorkers=1 \
  --reporter=json --outputFile=/evidence/api-unit.json
check host-unit npm run test --workspace=packages/artifacts-host -- --maxWorkers=1 \
  --reporter=json --outputFile=/evidence/host-unit.json
check mcp-unit npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' --maxWorkers=1 \
  --reporter=json --outputFile=/evidence/mcp-unit.json
check migrate npm run db:migrate --workspace=api
ARTIFACTS_PROVIDER_ACCEPTANCE=1 check artifacts-integration npm run test --workspace=api -- tests/integration/artifacts \
  --maxWorkers=1 --reporter=json --outputFile=/evidence/artifacts-integration.json
exit "$overall"
