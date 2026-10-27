import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
/* global fetch, AbortSignal, Buffer */
const lock = JSON.parse(readFileSync('package-lock.json'));
const manifest = JSON.parse(readFileSync('packages/immo-mcp/package.json'));
for (const workspace of ['api', 'packages/artifacts-host']) {
  const dependency = JSON.parse(readFileSync(`${workspace}/package.json`)).dependencies['@sentropic/artifacts'];
  assert.equal(dependency, '0.2.2');
}
const expected = [
  ['artifacts', '0.2.2', 'sha512-3ukuz+vEj+MoF/hkLswwtjG1uQNIMC5SIsjroxHacU6tYH2KnlOaic2vXxcJaHM9S5CSX1bU7dJurkKt+xldRw=='],
  ['cluster-mesh', '0.22.1', 'sha512-iwNigaE1/EOz92/ZrPRYfVAYMK5inzWV6G+Dgu8rGum8QuwyT7VjS44KylnkzMpBBPKDbQHTg83/kCZ6L0+Z2w=='],
  ['mcp-auth', '0.2.1'], ['mcp-platform', '0.4.0'],
];
const receipts = [];
for (const [name, version, frozenIntegrity] of expected) {
  const id = '@sentropic/' + name;
  const entry = lock.packages[`packages/immo-mcp/node_modules/${id}`] ?? lock.packages[`node_modules/${id}`];
  assert.equal(entry.version, version);
  if (name !== 'mcp-platform') assert.equal(manifest.dependencies[id], version);
  if (frozenIntegrity) assert.equal(entry.integrity, frozenIntegrity);
  const response = await fetch(`https://registry.npmjs.org/${id}/${version}`, { signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok);
  const metadata = await response.json();
  assert.equal(metadata.dist.integrity, entry.integrity);
  assert.equal(metadata.dist.tarball, entry.resolved);
  const archive = await fetch(entry.resolved, { signal: AbortSignal.timeout(10000) });
  assert.ok(archive.ok);
  const bytes = Buffer.from(await archive.arrayBuffer());
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, entry.integrity);
  assert.ok(metadata.dist.signatures?.length);
  assert.ok(metadata.dist.attestations?.url);
  receipts.push({ name: id, version, integrity: entry.integrity, sha256: createHash('sha256').update(bytes).digest('hex'),
    registrySignaturesPresent: true, provenanceUrl: metadata.dist.attestations.url });
}
const baseline = JSON.parse(readFileSync('/evidence/baseline-lock.json'));
const artifactsPath = 'node_modules/@sentropic/artifacts';
const workspaces = ['api', 'packages/artifacts-host', 'packages/immo-mcp'];
const allowedPaths = new Set([...workspaces, artifactsPath]);
const changed = [...new Set([...Object.keys(baseline.packages), ...Object.keys(lock.packages)])]
  .filter((path) => JSON.stringify(baseline.packages[path]) !== JSON.stringify(lock.packages[path]));
for (const path of changed) assert.ok(allowedPaths.has(path), `unrelated lockfile change: ${path}`);
assert.equal(changed.length, 4);
const expectedLock = globalThis.structuredClone(baseline);
for (const workspace of workspaces) expectedLock.packages[workspace].dependencies['@sentropic/artifacts'] = '0.2.2';
for (const field of ['version', 'resolved', 'integrity']) {
  expectedLock.packages[artifactsPath][field] = lock.packages[artifactsPath][field];
}
assert.deepEqual(lock, expectedLock, 'lockfile must change only the artifacts pins and published bytes');
writeFileSync('/evidence/tuple-proof.json', JSON.stringify({ receipts, changedLockEntries: changed }, null, 2));
console.log(JSON.stringify({ passed: true, receipts, changedLockEntries: changed }, null, 2));
