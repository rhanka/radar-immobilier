import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sha256 } from '../../lib/refc1.mjs';
import { dir, home, freeze, split, json, save } from './context.mjs';
const r = json(`${dir}/results.json`), files = fs.readdirSync(`${home}/responses`);
assert.equal(r.run.calls, 100); assert.equal(files.length, 100);
assert.equal(r.promptSha256, sha256(fs.readFileSync(`${dir}/prompt.md`)));
assert.equal(r.promptSha256, freeze.promptSha256);
assert.equal(r.halves.total.support, 676);
assert.equal(r.halves.tuning.support, 372); assert.equal(r.halves.blind.support, 304);
for (const id of split.blind) {
  assert(!files.includes(`${id}.json`));
  assert(fs.readFileSync(`${home}/responses/${id}.sealed`).subarray(0, 5).equals(Buffer.from('REFC1')));
}
for (const half of ['tuning', 'blind', 'total']) {
  const h = r.halves[half];
  assert(h.ps.found <= h.visible.found && h.visible.found <= h.detection.found);
  for (const k of ['ps', 'visible', 'detection']) {
    assert.equal(h[k].found + h[k].missed, h.support);
    assert(h[k].wilsonLower95 <= h[k].recall + 1e-12);
  }
}
assert(!/"(?:quote|reason|unit|text|votes)"\s*:/.test(fs.readFileSync(`${dir}/results.json`, 'utf8')));
// Session indexes and logs can contain prompt residues. Seal them under this lane only.
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
console.log(JSON.stringify({ verified: true, calls: 100, blindSeals: 50, sealedResidues: residues.length, toolEvents: r.halves.total.toolEvents }));
