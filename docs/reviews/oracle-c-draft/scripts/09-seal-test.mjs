#!/usr/bin/env node
// Seals the held-out test set: encrypts blind.jsonl (AES-256-GCM) to a path OUTSIDE the
// repository, with a key file also outside the repository, verifies the round trip against
// SHA256SUMS, deletes the plaintext from the workspace and records the act in the audit log.
// To be run by the test executor (who keeps the key), never by the prompt optimiser.
// Usage: ORACLE_C_ROLE=test-executor node 09-seal-test.mjs <sealed-out-path> <key-file>
//        (the key file is created, mode 600, if it does not exist)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './lib/common.mjs';
import { sealBuffer, unsealBuffer, readKey, expectedSha, audit } from './lib/testset.mjs';

const [,, out, keyFile] = process.argv;
if (process.env.ORACLE_C_ROLE !== 'test-executor' || !out || !keyFile) { console.error('usage: ORACLE_C_ROLE=test-executor 09-seal-test.mjs <sealed-out> <key-file>'); process.exit(2); }
const repoTop = path.resolve(ROOT, '..', '..', '..');
for (const p of [out, keyFile]) if (path.resolve(p).startsWith(repoTop)) { console.error(`${p} must be outside the repository`); process.exit(2); }
const plainPath = path.join(ROOT, 'blind.jsonl');
const plain = fs.readFileSync(plainPath);
const sha = crypto.createHash('sha256').update(plain).digest('hex');
if (sha !== expectedSha('blind.jsonl')) { console.error('blind.jsonl differs from SHA256SUMS'); process.exit(1); }
if (!fs.existsSync(keyFile)) {
  fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
}
const key = readKey(keyFile);
const sealed = sealBuffer(plain, key);
fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
fs.writeFileSync(out, sealed, { mode: 0o600 });
const back = unsealBuffer(fs.readFileSync(out), key);
if (crypto.createHash('sha256').update(back).digest('hex') !== sha) { console.error('round trip failed; plaintext kept'); process.exit(1); }
fs.rmSync(plainPath);
audit({ action: 'seal-test-set', datasetSha256: sha, sealedSha256: crypto.createHash('sha256').update(sealed).digest('hex') });
console.log(JSON.stringify({ sealed: out, datasetSha256: sha }));
