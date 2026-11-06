// Pre-flight ceilings (G0 v3 §4.1) and candidate digest (§4.3, DRAFT form).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, manifestDigest, scanDist } from './git-artifact-dist.mjs';

const dist = files => {
  const dir = mkdtempSync(join(tmpdir(), 'git-artifact-dist-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
};

test('the server ceilings are 255 files, 16 MiB per file, 64 MiB per release', () => {
  assert.deepEqual(LIMITS, { maxFiles: 255, maxFileBytes: 16777216, maxTotalBytes: 67108864 });
});

test('a dist within the ceilings passes with a stable digest', () => {
  const s = scanDist(dist({ 'index.html': '<!doctype html>', 'assets/a.js': 'x' }));
  assert.equal(s.code, null);
  assert.equal(s.fileCount, 2);
  assert.equal(s.totalBytes, 16);
  assert.match(s.candidateDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(s.candidateDigest, manifestDigest([...s.files].reverse()), 'order independent');
  assert.notEqual(s.candidateDigest, scanDist(dist({ 'index.html': '<!doctype html>', 'assets/a.js': 'y' })).candidateDigest);
});

test('overflow is dist_over_limits', () => {
  const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`f${i}.txt`, '']));
  assert.equal(scanDist(dist({ ...many, 'index.html': '' })).code, 'dist_over_limits');
  const big = scanDist(dist({ 'index.html': '', 'big.bin': Buffer.alloc(LIMITS.maxFileBytes + 1) }));
  assert.equal(big.code, 'dist_over_limits');
  assert.ok(big.violations.some(v => v.startsWith('file big.bin')));
  const total = scanDist(dist({ 'index.html': '', 'a.bin': Buffer.alloc(40) }), { limits: { ...LIMITS, maxTotalBytes: 32 } });
  assert.ok(total.violations.some(v => v.startsWith('total ')));
});

test('a missing entry or a symlink is refused', () => {
  assert.ok(scanDist(dist({ 'a.js': '' })).violations.includes('entry index.html missing'));
  const dir = dist({ 'index.html': '' });
  symlinkSync('/etc/passwd', join(dir, 'leak'));
  assert.ok(scanDist(dir).violations.includes('non-regular entry leak'));
});
