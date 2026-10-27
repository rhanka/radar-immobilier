#!/usr/bin/env bash
set -euo pipefail
cd /workspace
sha256sum --check --quiet /evidence/files.sha256
if [[ ${PWA_OFFLINE:-0} == 1 ]]; then
  source tools/make/base-api-pwa-offline-container.sh
else
  if ! command -v curl >/dev/null || ! command -v jq >/dev/null; then
    apt-get update > /evidence/system-packages.log 2>&1
    apt-get install -y --no-install-recommends curl jq >> /evidence/system-packages.log 2>&1
  fi
  dpkg-query -W curl jq > /evidence/system-package-versions.txt
fi
if [[ ${2:-full} == sequence ]]; then
  exec bash tools/make/base-api-pwa-sequence-container.sh "$1" "${3:-1}"
fi
if [[ ${2:-full} == full || ${2:-full} == scoped ]]; then
bash tools/make/base-api-container.sh test-api "$1"
cp /evidence/tests.json /evidence/scoped-tests.json
cp /evidence/tests.tsv /evidence/scoped-tests.tsv
[[ ${2:-full} != scoped ]] || exit 0
npm run typecheck --workspace=api
npm run typecheck --workspace=packages/artifacts-host --workspace=packages/immo-mcp
cat > api/tsconfig.pwa-tests.json <<'CONFIG'
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"..","noEmit":true},"include":["src/**/*.ts","tests/integration/pw-write-authority*.ts"],"exclude":["dist","node_modules"]}
CONFIG
node_modules/.bin/tsc --noEmit -p api/tsconfig.pwa-tests.json
node_modules/.bin/eslint .
for file in tools/make/base-api-pwa*.sh; do bash -n "$file"; done
npm run build --workspace=api
if [[ -f tools/make/base-api-pwa-mutations.mjs ]]; then node tools/make/base-api-pwa-mutations.mjs; fi
npm run test --workspace=api -- --config vitest.isolated.config.ts \
  --reporter=default --reporter=json --outputFile.json=/evidence/ci-tests.json
node tools/make/base-api-results.mjs /evidence/ci-tests.json > /evidence/ci-tests.tsv
else
  bash tools/make/base-api-container.sh typecheck ''
fi
mkdir -p tmp
printf '%s\n' 'export default { envDir: false, test: { maxWorkers: 1, fileParallelism: false } };' > tmp/pwa-packages.config.mjs
for package in artifacts-host immo-mcp; do
  if [[ ${2:-full} == mcp && $package == artifacts-host ]]; then continue; fi
  (cd "packages/$package"; ../../node_modules/.bin/vitest run --config /workspace/tmp/pwa-packages.config.mjs \
    --exclude '**/*.e2e.test.ts' --reporter=default --reporter=json \
    --outputFile.json="/evidence/$package-tests.json")
done
