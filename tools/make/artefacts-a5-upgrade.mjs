import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
/* global fetch, AbortSignal, Buffer */

const integrity = 'sha512-kjnky53W1LQxEWDree4uruLTv4ip3l1lX3oQwFz18gUU9hLtDd+i1+q5OEhQrbVyS8sx7Sn+JWSfHe2/wBQXrA==';
const response = await fetch('https://registry.npmjs.org/@sentropic/artifacts/0.2.1',
  { signal: AbortSignal.timeout(10000) });
assert.ok(response.ok);
const metadata = await response.json();
assert.equal(metadata.dist.integrity, integrity);
assert.equal(metadata.dist.tarball, 'https://registry.npmjs.org/@sentropic/artifacts/-/artifacts-0.2.1.tgz');
const archive = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(10000) });
assert.ok(archive.ok);
const bytes = Buffer.from(await archive.arrayBuffer());
assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, integrity);
writeFileSync('/evidence/upgrade-integrity.json', JSON.stringify({
  version: metadata.version, integrity, sha256: createHash('sha256').update(bytes).digest('hex'),
  verifiedBeforeInstallation: true,
}, null, 2));
console.log('PASS: published artifacts 0.2.1 integrity verified before installation');
