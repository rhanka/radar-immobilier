import fs from 'node:fs';
import assert from 'node:assert/strict';
import { sha256 } from '../lib/refc1.mjs';
import { dir, home, split, context, load } from './context.mjs';
context();
const result = JSON.parse(fs.readFileSync(`${dir}/results.json`, 'utf8'));
let n = 0;
for (const half of ['tuning', 'blind']) {
  const blind = half === 'blind', rows = load(`${home}/reference/${half}-final`, blind);
  assert.equal(rows.length, split.summary[half].bActs);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const r of rows) {
    assert.equal(r.blind, blind);
    assert(split[half].includes(r.document));
    assert.equal(r.votes.length, 2);
    assert.equal(r.shown, r.finalClass !== 'N');
    if (!r.disputed) assert(r.votes.every((v) => v.valid) && r.votes[0].code === r.votes[1].code);
    else if (r.arbitration.status !== 'resolved') assert.equal(r.finalClass, 'Non classé');
  }
  assert.equal(sha256(JSON.stringify(rows)), result.referenceHashes[half].plainSha256);
  if (blind) assert.equal(sha256(fs.readFileSync(`${home}/reference/blind-final.sealed`)), result.referenceHashes.blind.sealedSha256);
  assert.deepEqual(Object.fromEntries(['P', 'S', 'Non classé', 'N'].map((c) => [c, rows.filter((r) => r.finalClass === c).length])), result.halves[half].classes);
  n += rows.length;
}
assert.equal(n, 676);
const sample = JSON.parse(fs.readFileSync(`${home}/reference/owner-sample.json`, 'utf8'));
assert(sample.length <= 20 && sample.every((r) => !r.blind && r.disputed && split.tuning.includes(r.document)));
assert.equal(sha256(fs.readFileSync(`${home}/reference/owner-sample.json`)), result.ownerSample.sha256);
assert.equal(result.agreement.matrix.flat().reduce((a, b) => a + b, 0), n);
assert.equal(Object.values(result.arbitration.outcomes).reduce((a, b) => a + b, 0), result.disputes);
assert(result.annotation.retries + result.arbitration.retries <= 40);
assert(result.arbitration.calls <= 776);
assert(!/"(?:votes|quote|reason|unit|input)"\s*:/.test(fs.readFileSync(`${dir}/results.json`, 'utf8')));
console.log(JSON.stringify({ reference: n, sample: sample.length, blindSample: 0, checks: 'réussis' }));
