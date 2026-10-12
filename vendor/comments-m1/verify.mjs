import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import console from 'node:console';

const base = 'vendor/comments-m1/';
const expected = {
  'source.tar': 'dd7656275b56ac8903103e44295b6f2c5b2173890d7e49a530ab2c3f5766eb98',
  'sentropic-comments-0.3.0.tgz': '16fb88cee3869b810a7b3215e0807fbc2445e458501cc6153510af8cedff3f0c',
  'contract-v1.json': 'e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0',
  'freeze-receipt.md': '095e1d50f4c64ddc7254ca7e86f10582e4d1c2f153ec5173c79cb62818dc92cb',
  'interface-errata.md': '057d47922da4ffec6a99ecb0655be4d4dd623f771370cbc641983ddec20ba006',
  'revision-hash-v1.json': '26ee62b09d22f39438c344a9223564f08e696eeba95ddd0558f357407a40f0c0',
};
for (const [path, digest] of Object.entries(expected)) {
  if (createHash('sha256').update(readFileSync(base + path)).digest('hex') !== digest) {
    throw new Error(`Retained software digest mismatch: ${path}`);
  }
}
const manifest = JSON.parse(readFileSync(base + 'contract-v1.json', 'utf8'));
if (manifest.source.commit !== '7b8e5daf022cc58819dfdfae43cd89a703a82f96' || manifest.contractVersion !== 'contract-v1') {
  throw new Error('Unexpected frozen contract identity');
}
let sourceChecks = 0;
for (const artifact of manifest.artifacts) {
  if (!artifact.path.startsWith('packages/comments/')) continue;
  const bytes = execFileSync('tar', ['-xOf', base + 'source.tar', artifact.path]);
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error(`Source mismatch: ${artifact.path}`);
  sourceChecks++;
}
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path.includes('node_modules/') && !entry.link && (!entry.version || !entry.resolved || !entry.integrity)) {
    throw new Error(`Incomplete locked archive identity: ${path}`);
  }
}
const archive = readFileSync(base + 'sentropic-comments-0.3.0.tgz');
const comments = lock.packages['node_modules/@sentropic/comments'];
if (comments?.resolved !== 'file:' + base + 'sentropic-comments-0.3.0.tgz' ||
    comments.integrity !== 'sha512-' + createHash('sha512').update(archive).digest('base64')) {
  throw new Error('Installed comments archive differs from the retained software');
}
if (lock.packages['node_modules/esbuild']?.version !== '0.25.12') throw new Error('Unqualified image bundler version');
console.log(`Verified six retained software identities, ${sourceChecks} frozen source assets and complete lock archive identities.`);
for (const [path, entry] of Object.entries(lock.packages)) {
  if (entry.dependencies?.['@sentropic/contracts']) {
    console.log(`contracts resolver: ${path} -> ${entry.dependencies['@sentropic/contracts']}`);
  }
}
