#!/bin/sh
# Invoked only inside the standalone Make-managed test container.
set -eu
: "${P0B_VERSION:=0.2.5}"
npm ci
p0b_stage=tmp/mcp-p0b
mkdir -p "$p0b_stage"
rm -rf "$p0b_stage/artifacts"
mkdir -p "$p0b_stage/artifacts/node_modules/@sentropic"
cp -R /candidate/src /candidate/l0-freeze /candidate/migrations /candidate/sql /candidate/docs \
  /candidate/examples /candidate/package.json /candidate/tsconfig.json /candidate/README.md \
  /candidate/CHANGELOG.md /candidate/LICENSE "$p0b_stage/artifacts/"
# Stamp only the disposable copy; prepare the complete IMMO workspace graph beside it.
node --input-type=module - "$p0b_stage" "$P0B_VERSION" <<'JS'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [stage, version] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const packagePath = `${stage}/artifacts/package.json`;
write(packagePath, { ...read(packagePath), version });
const corePath = `${stage}/artifacts/src/mcp-core.ts`;
const core = readFileSync(corePath, 'utf8');
const versionPattern = /export const ARTIFACTS_PROVIDER_VERSION = ['"][^'"]+['"];/;
if (!versionPattern.test(core)) throw new Error('candidate_provider_version_missing');
writeFileSync(corePath, core.replace(versionPattern, `export const ARTIFACTS_PROVIDER_VERSION = ${JSON.stringify(version)};`));
const graph = `${stage}/graph`;
rmSync(graph, { recursive: true, force: true });
for (const path of ['.', 'api', 'ui', ...readdirSync('packages').map((name) => `packages/${name}`)]) {
  if (!existsSync(`${path}/package.json`)) continue;
  mkdirSync(`${graph}/${path}`, { recursive: true });
  copyFileSync(`${path}/package.json`, `${graph}/${path}/package.json`);
}
const root = read(`${graph}/package.json`);
root.dependencies['@sentropic/artifacts'] = `file:${resolve(stage, `sentropic-artifacts-${version}.tgz`)}`;
write(`${graph}/package.json`, root);
copyFileSync('package-lock.json', `${graph}/package-lock.json`);
JS
# Match the upstream build compiler; IMMO itself is checked with its pinned 5.9.3.
npm install --prefix "$p0b_stage/toolchain" --no-package-lock --ignore-scripts --no-audit --no-fund typescript@5.4.5
ln -s /workspace/packages/immo-mcp/node_modules/@sentropic/mcp-platform "$p0b_stage/artifacts/node_modules/@sentropic/mcp-platform"
"$p0b_stage/toolchain/node_modules/.bin/tsc" -p "$p0b_stage/artifacts/tsconfig.json"
(cd "$p0b_stage/artifacts" && npm pack --pack-destination ..)
# Exercise npm's peer resolver without changing the checkout's pin or lockfile.
npm install --prefix "$p0b_stage/graph" --package-lock-only --ignore-scripts --no-audit --no-fund
npm ls --prefix "$p0b_stage/graph" --package-lock-only @sentropic/artifacts @sentropic/cluster-mesh
sha256sum "$p0b_stage/sentropic-artifacts-$P0B_VERSION.tgz"
tar -xzf "$p0b_stage/sentropic-artifacts-$P0B_VERSION.tgz" -C node_modules/@sentropic/artifacts --strip-components=1
npm run typecheck --workspace=packages/immo-mcp
npm run typecheck --workspace=packages/artifacts-host
npm run typecheck --workspace=api
npx --no-install eslint packages/immo-mcp/src packages/artifacts-host/src api/src/artifacts/control-route*.ts
p0b_status=0
npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' || p0b_status=1
# Keep the existing S3 deadline assertions isolated from other test files.
npm run test --workspace=packages/artifacts-host -- --maxWorkers=1 || p0b_status=1
exit "$p0b_status"
