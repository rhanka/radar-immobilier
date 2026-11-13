// Secondary comparison only: unchanged historical B scorer on both native graphs.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { bench, arm } from './baseline.mjs';
import { dir, home, json, load, references, documents, write } from './context.mjs';
import { sha256 } from '../../lib/refc1.mjs';
import { metric } from './metrics.mjs';
const scorer = `${bench}/harness/score-oracle-v2.mjs`;
const { scoreValidV2 } = await import(pathToFileURL(scorer));
const docs = new Map(documents().map((d) => [d.id, d]));
const manifest = json(`${home}/request-manifest.json`), cases = [];
for (const ref of references()) {
  const d = docs.get(ref.itemId);
  const combined = { nodes: [], edges: [], evidence: [] };
  for (const part of manifest.filter((r) => r.document === d.id)) {
    const accepted = load(`${home}/validated/${part.key}`, d.blind);
    if (!accepted.accepted) continue;
    for (const key of Object.keys(combined)) combined[key].push(...(accepted.result.extraction[key] ?? []));
  }
  const options = { useStageAliases: true, partialOracle: false };
  const score = (output) => scoreValidV2(output, d, ref.expected.units, options).tp;
  cases.push({ blind: d.blind, n: ref.expected.units.length, detection: score(combined),
    baseline: score(json(`${arm}/validated/medium--${d.id}.output.json`)) });
}
const halves = Object.fromEntries(['tuning', 'blind', 'total'].map((half) => {
  const cs = cases.filter((c) => half === 'total' || c.blind === (half === 'blind')), n = cs.reduce((s, c) => s + c.n, 0);
  return [half, Object.fromEntries(['detection', 'baseline'].map((m) => [m, metric(cs.reduce((s, c) => s + c[m], 0), n)]))];
}));
assert.equal(halves.total.baseline.found, 336, 'must reproduce published B score');
write(`${dir}/historical.json`, JSON.stringify({ at: new Date().toISOString(), secondary: true,
  scorerSha256: sha256(fs.readFileSync(scorer)),
  warning: 'Secondary historical B scorer; not one-to-one; normalized whitespace; native stages unchanged. No prompt change.', halves }) + '\n');
console.log(JSON.stringify(halves));
