import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
/* global fetch, AbortSignal, Buffer */
const lock = JSON.parse(readFileSync('package-lock.json'));
const manifest = JSON.parse(readFileSync('packages/immo-mcp/package.json'));
for (const workspace of ['api', 'packages/artifacts-host']) {
  const dependency = JSON.parse(readFileSync(`${workspace}/package.json`)).dependencies['@sentropic/artifacts'];
  assert.equal(dependency, '0.2.1');
}
const expected = [
  ['artifacts', '0.2.1', 'sha512-kjnky53W1LQxEWDree4uruLTv4ip3l1lX3oQwFz18gUU9hLtDd+i1+q5OEhQrbVyS8sx7Sn+JWSfHe2/wBQXrA=='],
  ['cluster-mesh', '0.22.0', 'sha512-xy+3lnR6mwu7R8asatuUbXunuVmaAg2BWnEgGVHaI79BGNXZhQ7npvNWRoO5XnWzQZY67i0JxQ0gaQKjsXGVYQ=='],
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
const allowedPaths = new Set(['api', 'packages/artifacts-host', 'packages/immo-mcp', 'node_modules/@sentropic/artifacts']);
const changed = [...new Set([...Object.keys(baseline.packages), ...Object.keys(lock.packages)])]
  .filter((path) => JSON.stringify(baseline.packages[path]) !== JSON.stringify(lock.packages[path]));
for (const path of changed) assert.ok(allowedPaths.has(path), `unrelated lockfile change: ${path}`);
assert.equal(changed.length, 4);
writeFileSync('/evidence/tuple-proof.json', JSON.stringify({ receipts, changedLockEntries: changed }, null, 2));
console.log(JSON.stringify({ passed: true, receipts, changedLockEntries: changed }, null, 2));
