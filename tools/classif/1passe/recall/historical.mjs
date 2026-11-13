// Secondary audit using the UNCHANGED published B scorer. Never replaces the frozen primary.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { bench, arm } from './baseline.mjs';
import { dir, home, json, load, references, documents, write } from './context.mjs';
import { parseJsonObject } from '../../run-seat.mjs';
import { sha256 } from '../../lib/refc1.mjs';
import { codesFrom, stage, norm } from '../matching.mjs';
import { predictionClass, metric } from './metrics.mjs';
const scorer = `${bench}/harness/score-oracle-v2.mjs`;
const { scoreValidV2 } = await import(pathToFileURL(scorer));
const codes = codesFrom(fs.readFileSync(`${dir}/prompt.md`, 'utf8'));
const docs = new Map(documents().map((d) => [d.id, d]));
function canonicalStage(value) {
  const t = norm(value);
  if (/piia/.test(t)) return 'piia';
  if (/derogation/.test(t)) return 'derogation_mineure';
  if (/ppcmoi/.test(t)) return 'ppcmoi';
  if (/usage conditionnel/.test(t)) return 'usage_conditionnel';
  return ({ motion: 'avis_motion', projet: 'projet_reglement', projet2: 'second_projet', adoption: 'adoption', consultation: 'consultation_publique' })[stage(value)] ?? 'inconnu';
}
const cases = [];
for (const ref of references()) {
  const d = docs.get(ref.itemId), r = load(`${home}/responses/${d.id}`, d.blind).result;
  const acts = r.code === 0 && !r.toolEvents && !r.errorEnvelope ? parseJsonObject(r.text)?.acts ?? [] : [];
  const nodes = acts.map((a, i) => ({ id: String(i), node_type: 'Signal', etape: canonicalStage(a.stage),
    label: a.object, class: predictionClass(a, codes), citations: [{ page: a.page, excerpt: a.quote,
      source_file: d.originalKey, rawRef: d.originalKey, docSha: d.sha256, sourceUrl: d.sourceUrl, modality: 'pdf' }] }));
  const options = { useStageAliases: true, partialOracle: false };
  const score = (nodes) => scoreValidV2({ nodes, edges: [] }, d, ref.expected.units, options).tp;
  const b = scoreValidV2(json(`${arm}/validated/medium--${d.id}.output.json`), d, ref.expected.units, options);
  cases.push({ blind: d.blind, n: ref.expected.units.length, detection: score(nodes),
    visible: score(nodes.filter((n) => n.class !== 'N')), ps: score(nodes.filter((n) => ['P', 'S'].includes(n.class))), baseline: b.tp });
}
const halves = Object.fromEntries(['tuning', 'blind', 'total'].map((half) => {
  const cs = cases.filter((c) => half === 'total' || c.blind === (half === 'blind')), n = cs.reduce((s, c) => s + c.n, 0);
  return [half, Object.fromEntries(['detection', 'visible', 'ps', 'baseline'].map((m) => [m, metric(cs.reduce((s, c) => s + c[m], 0), n)]))];
}));
assert.equal(halves.total.baseline.found, 336, 'must reproduce published B score');
write(`${dir}/historical.json`, JSON.stringify({ at: new Date().toISOString(), secondary: true, scorerSha256: sha256(fs.readFileSync(scorer)),
  warning: 'Post-run diagnostic; original B scorer is not one-to-one and normalizes whitespace. Candidate stages adapted mechanically. No prompt change, no optimizer.', halves }) + '\n');
console.log(JSON.stringify(halves));
