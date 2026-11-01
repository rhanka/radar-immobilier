#!/bin/sh
# Invoked only inside the standalone Make-managed test container.
set -eu
npm ci
p0b_stage=tmp/mcp-p0b
mkdir -p "$p0b_stage"
rm -rf "$p0b_stage/artifacts"
mkdir -p "$p0b_stage/artifacts/node_modules/@sentropic"
cp -R /candidate/src /candidate/l0-freeze /candidate/migrations /candidate/sql /candidate/docs \
  /candidate/examples /candidate/package.json /candidate/tsconfig.json /candidate/README.md \
  /candidate/CHANGELOG.md /candidate/LICENSE "$p0b_stage/artifacts/"
# Match the upstream build compiler; IMMO itself is checked with its pinned 5.9.3.
npm install --prefix "$p0b_stage/toolchain" --no-package-lock --ignore-scripts --no-audit --no-fund typescript@5.4.5
ln -s /workspace/packages/immo-mcp/node_modules/@sentropic/mcp-platform "$p0b_stage/artifacts/node_modules/@sentropic/mcp-platform"
"$p0b_stage/toolchain/node_modules/.bin/tsc" -p "$p0b_stage/artifacts/tsconfig.json"
(cd "$p0b_stage/artifacts" && npm pack --pack-destination ..)
tar -xzf "$p0b_stage/sentropic-artifacts-0.3.0.tgz" -C node_modules/@sentropic/artifacts --strip-components=1
npm run typecheck --workspace=packages/immo-mcp
npm run typecheck --workspace=packages/artifacts-host
npm run typecheck --workspace=api
npx --no-install eslint packages/immo-mcp/src packages/artifacts-host/src api/src/artifacts/control-route*.ts
p0b_status=0
npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' || p0b_status=1
npm run test --workspace=packages/artifacts-host || p0b_status=1
exit "$p0b_status"
