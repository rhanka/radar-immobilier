import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sha256 } from '../../lib/refc1.mjs';
import { dir, home, freeze, json, save } from './context.mjs';
const r = json(`${dir}/results.json`), manifest = json(`${home}/request-manifest.json`);
assert.equal(r.run.calls, 100); assert.equal(fs.readdirSync(`${home}/responses`).length, 100);
assert.deepEqual(r.freeze, freeze);
assert.equal(sha256(JSON.stringify(json(`${home}/proofs.json`))), freeze.requestManifestSha256);
assert.equal(r.halves.total.support, 676); assert.equal(r.halves.tuning.support, 372); assert.equal(r.halves.blind.support, 304);
for (const p of manifest) {
  assert.equal(sha256(json(`${home}/requests/${p.key}.json`).input), p.inputSha256);
  if (!p.blind) continue;
  for (const type of ['responses', 'validated']) {
    assert(!fs.existsSync(`${home}/${type}/${p.key}.json`));
    assert(fs.readFileSync(`${home}/${type}/${p.key}.sealed`).subarray(0, 5).equals(Buffer.from('REFC1')));
  }
}
for (const half of ['tuning', 'blind', 'total']) {
  const h = r.halves[half];
  assert(h.ps.found <= h.visible.found && h.visible.found <= h.detection.found);
  assert.equal(h.accepted + h.failures, h.pv);
  for (const k of ['ps', 'visible', 'detection']) {
    assert.equal(h[k].found + h[k].missed, h.support); assert(h[k].wilsonLower95 <= h[k].recall + 1e-12);
  }
}
assert(!/"(?:quote|reason|unit|text|votes)"\s*:/.test(fs.readFileSync(`${dir}/results.json`, 'utf8')));
const residues = [], seat = `${home}/seat`;
function collect(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const file = path.join(p, e.name);
    if (e.isDirectory()) collect(file);
    else if (!['auth.json', 'config.toml'].includes(path.relative(seat, file))) residues.push({ file, bytes: fs.readFileSync(file).toString('base64') });
  }
}
collect(seat);
if (residues.length) {
  save(`${home}/seat-residues-${Date.now()}`, residues, true);
  for (const row of residues) fs.rmSync(row.file);
}
writeResult();
function writeResult() {
  const proof = { verified: true, calls: 100, blindSeals: 50, nativeAccepted: r.halves.total.nativeAccepted,
    v9Accepted: r.halves.total.v9Accepted, sealedResidues: residues.length, toolEvents: r.halves.total.toolEvents };
  fs.writeFileSync(`${dir}/verification.json`, JSON.stringify(proof) + '\n'); console.log(JSON.stringify(proof));
}
