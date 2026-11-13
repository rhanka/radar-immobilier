import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sha256, seal, unseal } from '../../lib/refc1.mjs';
export const dir = 'tools/classif/1passe/recall1099';
export const home = path.join(os.homedir(), '.local/share/radar-classif/1passe-recall1099');
export const source = path.join(os.homedir(), '.local/share/radar-classif/1passe-bc');
export const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const split = json('tools/classif/1passe/split.json');
export const freeze = fs.existsSync(`${dir}/freeze.json`) ? json(`${dir}/freeze.json`) : null;
const key = Buffer.from(fs.readFileSync(`${source}/custody/blind-key.base64`, 'utf8').trim(), 'base64');
export function write(p, value) {
  assert(p.startsWith(`${home}/`) || p.startsWith(`${dir}/`), 'lane writes only');
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
export function audit(event) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.appendFileSync(`${home}/access-log.jsonl`, JSON.stringify({ at: new Date().toISOString(),
    role: 'test-executor', actor: 'i-cond-lane-recall1099', ...event }) + '\n', { mode: 0o600 });
}
export function save(p, value, blind) {
  assert(p.startsWith(`${home}/`));
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const bytes = blind ? seal(key, Buffer.from(JSON.stringify(value))) : Buffer.from(JSON.stringify(value));
  fs.writeFileSync(`${p}.${blind ? 'sealed' : 'json'}`, bytes, { flag: 'wx', mode: 0o600 });
  audit({ action: blind ? 'seal-answer' : 'save-answer', artifact: path.basename(p), sha256: sha256(bytes) });
}
export function load(p, blind) {
  const bytes = fs.readFileSync(`${p}.${blind ? 'sealed' : 'json'}`);
  if (blind) audit({ action: 'open-artifact', artifact: path.basename(p), sha256: sha256(bytes) });
  return JSON.parse(blind ? unseal(key, bytes).toString() : bytes.toString());
}
export function references() {
  const bytes = fs.readFileSync(`${source}/blind/blind.sealed`);
  assert.equal(sha256(bytes), split.blindSeal.sealedSha256);
  const plain = unseal(key, bytes);
  assert.equal(sha256(plain), split.blindSeal.plainSha256);
  audit({ action: 'open-B-oracle', purpose: 'frozen-production-recall', sha256: sha256(plain) });
  const tuning = fs.readFileSync(`${source}/tuning.jsonl`, 'utf8');
  assert.equal(sha256(tuning), split.tuningDataSha256);
  return [...tuning.trim().split('\n').map(JSON.parse), ...plain.toString().trim().split('\n').map(JSON.parse)];
}
export function documents() {
  return json(`${source}/source/manifest.json`).documents.map((d) => {
    const text = fs.readFileSync(`${source}/texts/${d.sha256}.txt`, 'utf8');
    assert.equal(sha256(text), d.textSha256);
    return { ...d, text, blind: split.blind.includes(d.id) };
  });
}
