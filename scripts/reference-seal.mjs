#!/usr/bin/env node
// Seal / unseal client reference data committed to this public repository.
// AES-256-GCM, key = base64 32 bytes read from $REFERENCE_C_KEY or the repo-root .env
// (the repository that contains this script, whatever the caller's working directory).
// File format: "REFC1" | iv (12) | tag (16) | ciphertext.
//
//   node scripts/reference-seal.mjs seal   <plain>... --out <dir>
//   node scripts/reference-seal.mjs unseal <file.sealed>... --out <dir>
//
// Output files are created exclusively (flag 'wx'): an existing file or symlink at the
// target path is refused, never overwritten or followed. Unseal writes plaintext in mode
// 0600 into an output directory that is created in mode 0700, or must already be 0700.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, lstatSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const MAGIC = Buffer.from('REFC1');
const KEY_VAR = 'REFERENCE_C_KEY';

function fail(message, code = 1) {
  console.error(`reference-seal: ${message}`);
  process.exit(code);
}

function loadKey() {
  let value = process.env[KEY_VAR];
  if (!value) {
    // Bind discovery to the repository containing this script; ignore inherited Git overrides.
    const env = { ...process.env };
    for (const v of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[v];
    const root = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: SCRIPT_DIR,
      env,
      encoding: 'utf8',
    }).trim();
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

function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

// Unseal output directory: create it in 0700, or require an existing one to be 0700.
function preparePrivateDir(dir) {
  if (!pathExists(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const st = statSync(dir);
  if (!st.isDirectory()) fail(`--out ${dir} is not a directory`);
  if ((st.mode & 0o077) !== 0) {
    const perm = (st.mode & 0o777).toString(8).padStart(3, '0');
    fail(`--out ${dir} has mode ${perm}; unseal requires a private directory (chmod 700 ${dir}, or use a new path)`);
  }
}

const [mode, ...rest] = process.argv.slice(2);
const outIdx = rest.indexOf('--out');
const files = outIdx < 0 ? rest : rest.filter((_, i) => i !== outIdx && i !== outIdx + 1);
if (!['seal', 'unseal'].includes(mode) || outIdx < 0 || !rest[outIdx + 1] || files.length === 0) {
  console.error('usage: reference-seal.mjs seal|unseal <files>... --out <dir>');
  process.exit(2);
}
const outDir = resolve(rest[outIdx + 1]);
const targets = files.map((file) =>
  join(outDir, mode === 'seal' ? `${basename(file)}.sealed` : basename(file).replace(/\.sealed$/, '')),
);
if (new Set(targets).size !== targets.length) fail('two inputs map to the same output name');

if (mode === 'unseal') preparePrivateDir(outDir);
else mkdirSync(outDir, { recursive: true });

// Refuse up front if any target already exists (file, directory or symlink), so nothing is
// written partially; the exclusive 'wx' flag below closes the race window.
const existing = targets.filter(pathExists);
if (existing.length > 0) {
  fail(`refusing to overwrite existing output (delete it first): ${existing.join(', ')}`);
}

const key = loadKey();
files.forEach((file, i) => {
  const input = readFileSync(file);
  const target = targets[i];
  const data = mode === 'seal' ? seal(key, input) : unseal(key, input);
  try {
    writeFileSync(target, data, { flag: 'wx', mode: mode === 'seal' ? 0o644 : 0o600 });
  } catch (err) {
    if (err.code === 'EEXIST') fail(`refusing to overwrite existing output (delete it first): ${target}`);
    throw err;
  }
  const shown = mode === 'seal' ? basename(file) : basename(target);
  console.log(`${sha256(mode === 'seal' ? input : data)}  ${shown}`);
});
