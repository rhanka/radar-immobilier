// REFC1 sealing, the mechanism of scripts/reference-seal.mjs (PR #831/#843), as a library.
// Format: "REFC1" | iv (12) | GCM tag (16) | AES-256-GCM ciphertext. Key = base64, 32 bytes.
// Differences with the CLI, on purpose: the key is read ONLY from a named environment variable
// (never from .env, never printed, never written), and plaintext stays in memory (no file).
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';

export const MAGIC = Buffer.from('REFC1');

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Reads a REFC1 key from the environment variable `name`. Throws without echoing the value. */
export function keyFromEnv(name, env = process.env) {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set in the environment (inject it at launch; .env is never read)`);
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes (base64)`);
  return key;
}

export function seal(key, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function unseal(key, sealed) {
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a REFC1 file');
  const iv = sealed.subarray(5, 17);
  const tag = sealed.subarray(17, 33);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(33)), decipher.final()]);
}

function exists(p) {
  try {
    lstatSync(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Seals `plain` to `target` (exclusive creation, mode 644 like reference-seal.mjs), then reads the
 * file back, unseals it and compares byte for byte. Returns { plainSha256, sealedSha256 }.
 */
export function sealToFile(key, plain, target) {
  if (exists(target)) throw new Error(`refusing to overwrite existing output: ${target}`);
  writeFileSync(target, seal(key, plain), { flag: 'wx', mode: 0o644 });
  const back = readFileSync(target);
  const round = unseal(key, back);
  if (!round.equals(plain)) throw new Error(`round trip failed for ${target}`);
  return { plainSha256: sha256(plain), sealedSha256: sha256(back) };
}

/** Parses a reference README hash table: rows "| `file.sealed` | ... | `<sha256>` |". */
export function readmeHashes(readmeText) {
  const out = new Map();
  for (const line of readmeText.split('\n')) {
    const m = line.match(/^\|\s*`([^`]+\.sealed)`\s*\|.*\|\s*`([0-9a-f]{64})`\s*\|\s*$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}
