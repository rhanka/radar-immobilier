// Later, local-only recalculation: no new model call and no optimizer feedback.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { sha256 } from '../../lib/refc1.mjs';
import { dir, home, source, json, load, write } from './context.mjs';
import { metric } from './metrics.mjs';
const b = json(`${dir}/results.json`), out = {}, referenceHashes = {};
for (const half of ['tuning', 'blind']) {
  const blind = half === 'blind', p = `${source}/reference/${half}-final`;
  assert(fs.existsSync(`${p}.${blind ? 'sealed' : 'json'}`), 'final C reference unavailable; do not wait or call a model');
  const reference = load(p, blind), scores = load(`${home}/${b.privateScores[half]}`, blind);
  referenceHashes[half] = sha256(fs.readFileSync(`${p}.${blind ? 'sealed' : 'json'}`));
  const byId = new Map(scores.map((s) => [s.id, s]));
  assert.equal(reference.length, half === 'tuning' ? 372 : 304);
  assert.equal(new Set(reference.map((r) => r.id)).size, reference.length);
  assert(reference.every((r) => byId.has(r.id) && r.blind === blind));
  const ps = reference.filter((r) => ['P', 'S'].includes(r.finalClass));
  const operational = reference.filter((r) => r.finalClass !== 'N');
  out[half] = {
    CpsVisible: metric(ps.filter((r) => byId.get(r.id).visible).length, ps.length),
    CpsPredictedPS: metric(ps.filter((r) => byId.get(r.id).ps).length, ps.length),
    CoperationalVisible: metric(operational.filter((r) => byId.get(r.id).visible).length, operational.length),
    classes: Object.fromEntries(['P', 'S', 'N', 'Non classé'].map((c) => [c, reference.filter((r) => r.finalClass === c).length])) };
}
out.total = Object.fromEntries(['CpsVisible', 'CpsPredictedPS', 'CoperationalVisible'].map((m) => [m,
  metric(out.tuning[m].found + out.blind[m].found, out.tuning[m].support + out.blind[m].support)]));
const result = { at: new Date().toISOString(), referenceHashes, promptSha256: b.promptSha256, halves: out };
write(`${dir}/results-c.json`, result);
console.log(JSON.stringify(result));
