import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
/* global fetch, AbortSignal, Buffer */

const integrity = 'sha512-iwNigaE1/EOz92/ZrPRYfVAYMK5inzWV6G+Dgu8rGum8QuwyT7VjS44KylnkzMpBBPKDbQHTg83/kCZ6L0+Z2w==';
const response = await fetch('https://registry.npmjs.org/@sentropic/cluster-mesh/0.22.1',
  { signal: AbortSignal.timeout(10000) });
assert.ok(response.ok);
const metadata = await response.json();
assert.equal(metadata.name, '@sentropic/cluster-mesh');
assert.equal(metadata.version, '0.22.1');
assert.equal(metadata.dist.integrity, integrity);
assert.equal(metadata.dist.tarball, 'https://registry.npmjs.org/@sentropic/cluster-mesh/-/cluster-mesh-0.22.1.tgz');
const archive = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(10000) });
assert.ok(archive.ok);
const bytes = Buffer.from(await archive.arrayBuffer());
assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, integrity);
assert.equal(createHash('sha1').update(bytes).digest('hex'), metadata.dist.shasum);
writeFileSync('/evidence/cluster-mesh-0.22.1.tgz', bytes);
writeFileSync('/evidence/upgrade-integrity.json', JSON.stringify({
  name: metadata.name, version: metadata.version, integrity, tarball: metadata.dist.tarball,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  registrySignaturesPresent: Boolean(metadata.dist.signatures?.length),
  provenanceUrl: metadata.dist.attestations?.url,
  verifiedBeforeInstallation: true,
}, null, 2));
console.log('PASS: published cluster-mesh 0.22.1 integrity verified before installation');
