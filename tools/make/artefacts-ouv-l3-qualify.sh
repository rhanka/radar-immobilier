#!/usr/bin/env bash
# Executed only inside the source-snapshot container by the standalone runner.
set -uo pipefail
[[ $PWD == /workspace && -d /evidence && ${NODE_ENV:-} == test ]] || exit 2
failed=0
: > /evidence/gates.tsv
record() {
  local name=$1 status=0; shift
  printf 'RUN %s\n' "$name"
  "$@" > "/evidence/$name.log" 2>&1 || status=$?
  printf '%s\t%s\n' "$name" "$status" | tee -a /evidence/gates.tsv
  if [[ $status != 0 ]]; then failed=1; tail -70 "/evidence/$name.log"; fi
}
record runner-tools bash -euc '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends curl jq openssl
  test -x /usr/bin/curl
  /usr/bin/curl --version
  jq --version
  openssl version
'
record typecheck npm run typecheck --workspaces --if-present
record eslint npx --no-install eslint . --ignore-pattern 'tmp/**'
record migrations npm run db:migrate --workspace=api
record api-unit env LOT_MIGRATION_DB_TEST=0 npm run test --workspace=api -- src --maxWorkers=1 \
  --reporter=default --reporter=json --outputFile=/evidence/api-unit.json
record postgres-reader npm run test --workspace=api -- tests/integration/classification \
  tests/integration/artifacts-baskets.spec.ts tests/integration/artifacts-reader-opening.spec.ts \
  --maxWorkers=1 --reporter=default --reporter=json --outputFile=/evidence/postgres-reader.json
record chromium-install npx --no-install playwright install --with-deps --only-shell chromium
record browser-reader env ARTIFACTS_BROWSER_ACCEPTANCE=1 npm run test --workspace=api -- \
  tests/integration/artifacts-baskets-browser.spec.ts --maxWorkers=1 \
  --reporter=default --reporter=json --outputFile=/evidence/browser-reader.json
record mutations node tools/make/artefacts-ouv-l3-mutations.mjs
# Same Vitest configuration and unfiltered API inventory as CI. Extra BASE
# PostgreSQL coverage is enabled by LOT_MIGRATION_DB_TEST in the runner.
record api-ci npm run test --workspace=api -- --maxWorkers=1 \
  --reporter=default --reporter=json --outputFile=/evidence/api-ci.json
node --input-type=module <<'JS'
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const gates = readFileSync('/evidence/gates.tsv', 'utf8').trim().split('\n').map((line) => {
  const [name, exit] = line.split('\t');
  const path = `/evidence/${name}.json`;
  const report = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  return { name, exit: Number(exit), status: exit === '0' ? 'passed' : 'failed',
    ...(report ? { passed: report.numPassedTests, failed: report.numFailedTests,
      skipped: report.numPendingTests, total: report.numTotalTests } : {}) };
});
writeFileSync('/evidence/results.json', JSON.stringify(gates, null, 2));
console.log(JSON.stringify(gates, null, 2));
JS
exit "$failed"
