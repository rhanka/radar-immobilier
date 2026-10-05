#!/usr/bin/env node
// Seal / unseal client reference data committed to this public repository.
// AES-256-GCM, key = base64 32 bytes read from $REFERENCE_C_KEY or the repo-root .env.
// File format: "REFC1" | iv (12) | tag (16) | ciphertext.
//
//   node scripts/reference-seal.mjs seal   <plain>... --out <dir>
//   node scripts/reference-seal.mjs unseal <file.sealed>... --out <dir>
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const MAGIC = Buffer.from('REFC1');
const KEY_VAR = 'REFERENCE_C_KEY';

function loadKey() {
  let value = process.env[KEY_VAR];
  if (!value) {
    const root = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const envPath = join(dirname(root), '.env');
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith(`${KEY_VAR}=`));
      if (line) value = line.slice(KEY_VAR.length + 1).trim();
    }
  }
  if (!value) throw new Error(`${KEY_VAR} not found (environment or repo-root .env)`);
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error(`${KEY_VAR} must decode to 32 bytes`);
  return key;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function seal(key, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function unseal(key, sealed) {
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a REFC1 file');
  const iv = sealed.subarray(5, 17);
  const tag = sealed.subarray(17, 33);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(33)), decipher.final()]);
}

const [mode, ...rest] = process.argv.slice(2);
const outIdx = rest.indexOf('--out');
if (!['seal', 'unseal'].includes(mode) || outIdx < 0 || !rest[outIdx + 1]) {
  console.error('usage: reference-seal.mjs seal|unseal <files>... --out <dir>');
  process.exit(2);
}
const outDir = resolve(rest[outIdx + 1]);
const files = rest.filter((_, i) => i !== outIdx && i !== outIdx + 1);
mkdirSync(outDir, { recursive: true });
const key = loadKey();
for (const file of files) {
  const input = readFileSync(file);
  if (mode === 'seal') {
    writeFileSync(join(outDir, `${basename(file)}.sealed`), seal(key, input));
    console.log(`${sha256(input)}  ${basename(file)}`);
  } else {
    const plain = unseal(key, input);
    const name = basename(file).replace(/\.sealed$/, '');
    writeFileSync(join(outDir, name), plain, { mode: 0o600 });
    console.log(`${sha256(plain)}  ${name}`);
  }
}
