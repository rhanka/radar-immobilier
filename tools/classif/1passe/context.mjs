import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sha256, sealToFile, unseal } from '../lib/refc1.mjs';
import { openBlindSet } from '../lib/blind.mjs';
export const dir = 'tools/classif/1passe';
export const home = path.join(os.homedir(), '.local/share/radar-classif/1passe-bc');
export const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const split = json(`${dir}/split.json`);
export const key = Buffer.from(fs.readFileSync(`${home}/custody/blind-key.base64`, 'utf8').trim(), 'base64');
export const env = { ...process.env, CLASSIF_ROLE: 'test-executor', CLASSIF_ACTOR: 'i-cond-lane-annotation', CLASSIF_BLIND_KEY: key.toString('base64') };
export function writePrivate(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data), { mode: 0o600 });
}
export function save(file, value, blind) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (blind) {
    const temporary = `${file}.${randomUUID()}.sealed`;
    try {
      const receipt = sealToFile(key, Buffer.from(JSON.stringify(value)), temporary);
      fs.renameSync(temporary, `${file}.sealed`);
      return receipt;
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  writePrivate(`${file}.json`, value);
  return { plainSha256: sha256(JSON.stringify(value)) };
}
export function load(file, blind) {
  if (!blind) return json(`${file}.json`);
  assert.equal(env.CLASSIF_ROLE, 'test-executor');
  const bytes = fs.readFileSync(`${file}.sealed`);
  fs.appendFileSync(`${home}/blind/access-log.jsonl`, `${JSON.stringify({ at: new Date().toISOString(),
    action: 'open-C-artifact', actor: env.CLASSIF_ACTOR, role: env.CLASSIF_ROLE,
    artifact: file.slice(home.length + 1), sealedSha256: sha256(bytes) })}\n`, { mode: 0o600 });
  return JSON.parse(unseal(key, bytes).toString());
}
export function context() {
  const manifest = json(`${home}/source/manifest.json`);
  const freeze = json(`${dir}/freeze.json`);
  for (const [f, h] of Object.entries(freeze.files)) assert.equal(sha256(fs.readFileSync(`${dir}/${f}`)), h, f);
  const annotation = json(`${dir}/annotation.json`);
  const pack = Object.entries(annotation.pack).map(([f, h]) => {
    const bytes = fs.readFileSync(path.join(home, '../l1/pack', f));
    assert.equal(sha256(bytes), h, f); return bytes.toString();
  }).join('\n\n');
  const texts = new Map(manifest.documents.map((d) => {
    const text = fs.readFileSync(`${home}/texts/${d.sha256}.txt`, 'utf8');
    assert.equal(sha256(text), d.textSha256, 'texte intégral');
    assert(text.length / 3 + pack.length / 3 < 160000, 'PV trop long');
    return [d.id, text];
  }));
  return { manifest, pack, texts };
}
export function referenceRows() {
  return [...fs.readFileSync(`${home}/tuning.jsonl`, 'utf8').trim().split('\n').map(JSON.parse),
    ...openBlindSet({ purpose: 'annotation-reference-C', home, env, expectPlainSha256: split.blindSeal.plainSha256 })];
}
