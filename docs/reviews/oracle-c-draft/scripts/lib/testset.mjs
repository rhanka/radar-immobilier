// Sealed test set (TEST-SET-PROTOCOL.md): the held-out set is stored encrypted OUTSIDE the
// repository; only its plaintext sha256 (SHA256SUMS) is visible. Every access is appended to a
// committed audit log. Only the test executor role, holding the key, can open it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from './common.mjs';

export const AUDIT_LOG = path.join(ROOT, 'test-access-log.jsonl');
const MAGIC = 'OCSEAL1';

export function sealBuffer(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from(MAGIC), iv, c.getAuthTag(), body]);
}

export function unsealBuffer(sealed, key) {
  if (sealed.subarray(0, MAGIC.length).toString() !== MAGIC) throw new Error('not a sealed test set');
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = sealed.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(sealed.subarray(MAGIC.length + 28)), d.final()]);
}

export const readKey = (file) => {
  const k = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  if (k.length !== 32) throw new Error('test key must be 32 bytes, base64');
  return k;
};

export const expectedSha = (name) => {
  const line = fs.readFileSync(path.join(ROOT, 'SHA256SUMS'), 'utf8').split('\n').find((l) => l.endsWith(`  ${name}`));
  if (!line) throw new Error(`${name} not in SHA256SUMS`);
  return line.split(/\s+/)[0];
};

export function audit(entry) {
  const rec = {
    at: new Date().toISOString(),
    who: process.env.ORACLE_C_ACTOR ?? os.userInfo().username,
    role: process.env.ORACLE_C_ROLE ?? null,
    ...entry,
  };
  fs.appendFileSync(AUDIT_LOG, `${JSON.stringify(rec)}\n`);
  return rec;
}

export function readAudit() {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  return fs.readFileSync(AUDIT_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Opens the sealed test set. Requires ORACLE_C_ROLE=test-executor, ORACLE_C_TEST_SEALED and
 *  ORACLE_C_TEST_KEY_FILE, both outside the repository. Logs the access. Returns parsed items. */
export function openTestSet({ purpose, promptSha256 = null }) {
  if (process.env.ORACLE_C_ROLE !== 'test-executor') throw new Error('test set refused: ORACLE_C_ROLE must be test-executor');
  const sealedPath = process.env.ORACLE_C_TEST_SEALED; const keyFile = process.env.ORACLE_C_TEST_KEY_FILE;
  if (!sealedPath || !keyFile) throw new Error('test set refused: ORACLE_C_TEST_SEALED and ORACLE_C_TEST_KEY_FILE required');
  for (const p of [sealedPath, keyFile]) {
    if (path.resolve(p).startsWith(path.resolve(ROOT, '..', '..', '..'))) throw new Error(`test set refused: ${p} must live outside the repository`);
  }
  const plain = unsealBuffer(fs.readFileSync(sealedPath), readKey(keyFile));
  const sha = crypto.createHash('sha256').update(plain).digest('hex');
  if (sha !== expectedSha('blind.jsonl')) throw new Error('test set refused: plaintext sha256 differs from SHA256SUMS');
  audit({ action: 'open-test-set', purpose, datasetSha256: sha, promptSha256 });
  return plain.toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
}

/** optim → plaintext dev set (hash-checked); blind → sealed test set (role + key, audited). */
export function loadSet(set, { purpose, promptSha256 = null } = {}) {
  if (set === 'blind') return openTestSet({ purpose, promptSha256 });
  const body = fs.readFileSync(path.join(ROOT, `${set}.jsonl`));
  if (crypto.createHash('sha256').update(body).digest('hex') !== expectedSha(`${set}.jsonl`)) throw new Error(`${set}.jsonl differs from SHA256SUMS`);
  return body.toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
}

/** Guard before a test run: prompt frozen in git BEFORE the run, never run before on test. */
export function assertTestRunAllowed({ promptVersion, promptSha256, model }) {
  const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  const fin = JSON.parse(fs.readFileSync(path.join(ROOT, 'final-prompt.json'), 'utf8'));
  if (fin.version !== promptVersion || fin.sha256 !== promptSha256) throw new Error('test run refused: prompt is not the frozen final prompt');
  for (const f of ['final-prompt.json', `prompt-c-${promptVersion}.md`]) {
    if (git('ls-files', '--error-unmatch', f).status !== 0) throw new Error(`test run refused: ${f} is not committed`);
    if (git('diff', '--quiet', 'HEAD', '--', f).status !== 0) throw new Error(`test run refused: ${f} differs from the committed version`);
  }
  const frozenIn = git('log', '-1', '--format=%H %cI', '--', 'final-prompt.json').stdout.trim();
  const previous = readAudit().filter((e) => e.action === 'test-run' && e.promptSha256 === promptSha256 && (!model || e.model === model));
  if (previous.length) throw new Error(`test run refused: prompt ${promptSha256.slice(0, 12)} already run on the test set (${previous[0].at})`);
  return { frozenIn };
}
