#!/usr/bin/env node
// Step 4 — homogeneous 50/50 split BEFORE any prompt work.
// Unit of partition = municipality (every line of a city lands in the same set), so that twin
// records, coupled bylaws and a city's recurring wording never straddle optim and blind.
// Balance is searched over all strata at once (deterministic seed), then the side that becomes
// "blind" is chosen by a seeded coin flip, not by the operator. Writes the frozen sets,
// SHA256SUMS, split-manifest.json and split-balance.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WORK, ROOT, VERDICTS } from './lib/common.mjs';
import { rng, chi2Test } from './lib/stats.mjs';

const SEED = 20261004;
const RESTARTS = 400;
const data = JSON.parse(fs.readFileSync(path.join(WORK, 'items.json'), 'utf8'));
const items = data.items;

const cityCount = {};
for (const it of items) cityCount[it.city] = (cityCount[it.city] ?? 0) + 1;
const STRATA = {
  verdict: (i) => i.label.verdict,
  motifFamily: (i) => i.label.motifFamily,
  sens: (i) => i.label.sens,
  pass: (i) => i.label.pass,
  region: (i) => (/Montérégie/.test(i.region) ? 'Montérégie' : i.region === 'Laurentides' ? 'Laurentides' : 'other regions'),
  docType: (i) => (['avis_motion', 'projet_reglement'].includes(i.docType) ? 'early-stage record'
    : i.docType === 'Procès-verbal' ? 'procès-verbal record' : 'adoption/other record'),
  nodeKind: (i) => {
    const s = i.nodeIds.some((x) => x.startsWith('signal-'));
    const e = i.nodeIds.some((x) => x.startsWith('event-'));
    return s && e ? 'signal+event' : s ? 'signal' : 'event';
  },
  length: (i) => i.lengthBucket,
  citySize: (i) => (cityCount[i.city] === 1 ? 'city with 1 line' : cityCount[i.city] <= 3 ? 'city with 2-3 lines' : 'city with 4+ lines'),
};
const WEIGHT = { verdict: 3, motifFamily: 2, sens: 2, pass: 2, region: 1, docType: 1, nodeKind: 1, length: 1, citySize: 1 };

const cats = {};
for (const [s, f] of Object.entries(STRATA)) cats[s] = [...new Set(items.map(f))].sort();
const cities = Object.keys(cityCount).sort();
const cityItems = Object.fromEntries(cities.map((c) => [c, items.filter((i) => i.city === c)]));
const vec = (list) => {
  const v = {};
  for (const [s, f] of Object.entries(STRATA)) { v[s] = Object.fromEntries(cats[s].map((c) => [c, 0])); for (const i of list) v[s][f(i)]++; }
  return v;
};
const cityVec = Object.fromEntries(cities.map((c) => [c, vec(cityItems[c])]));
const total = vec(items);

function cost(sideA) {
  // sideA: Set of cities. Normalised squared deviation from a perfect half, per category.
  const a = vec([]);
  let n = 0;
  for (const c of sideA) { n += cityItems[c].length; for (const s in a) for (const k in a[s]) a[s][k] += cityVec[c][s][k]; }
  let sum = 0;
  for (const s in a) for (const k in a[s]) { const T = total[s][k]; const d = a[s][k] - T / 2; sum += WEIGHT[s] * (d * d) / Math.max(1, T); }
  const dn = n - items.length / 2;
  return sum + 20 * dn * dn;
}

const rand = rng(SEED);
let best = null; let bestCost = Infinity;
for (let r = 0; r < RESTARTS; r++) {
  const side = new Set(cities.filter(() => rand() < 0.5));
  let cur = cost(side);
  for (let improved = true; improved;) {
    improved = false;
    for (const c of cities) { // single moves
      side.has(c) ? side.delete(c) : side.add(c);
      const v = cost(side);
      if (v < cur - 1e-9) { cur = v; improved = true; } else { side.has(c) ? side.delete(c) : side.add(c); }
    }
    for (const c1 of cities) for (const c2 of cities) { // swaps
      if (side.has(c1) === side.has(c2)) continue;
      const in1 = side.has(c1);
      if (in1) { side.delete(c1); side.add(c2); } else { side.add(c1); side.delete(c2); }
      const v = cost(side);
      if (v < cur - 1e-9) { cur = v; improved = true; } else if (in1) { side.add(c1); side.delete(c2); } else { side.delete(c1); side.add(c2); }
    }
  }
  if (cur < bestCost) { bestCost = cur; best = new Set(side); }
}

const blindIsA = rand() < 0.5;
const isBlind = (it) => (best.has(it.city) === blindIsA);
const sets = { optim: items.filter((i) => !isBlind(i)), blind: items.filter(isBlind) };

const strip = (it) => ({
  id: it.id, excelRow: it.excelRow, city: it.city, nodeIds: it.nodeIds, missingNodeIds: it.missingNodeIds,
  strata: Object.fromEntries(Object.entries(STRATA).map(([s, f]) => [s, f(it)])),
  label: it.label, input: it.input,
});
const shas = {};
for (const [name, list] of Object.entries(sets)) {
  const body = list.map((i) => JSON.stringify(strip(i))).join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, `${name}.jsonl`), body);
  shas[name] = crypto.createHash('sha256').update(body).digest('hex');
}
fs.writeFileSync(path.join(ROOT, 'SHA256SUMS'), `${shas.optim}  optim.jsonl\n${shas.blind}  blind.jsonl\n`);

// ---- balance report (aggregates only) ----
const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(1)} %` : 'N-A');
let md = `# Split balance — optim vs blind (oracle C draft)\n\n`;
md += `Produced by \`scripts/04-split.mjs\` (seed ${SEED}, ${RESTARTS} restarts, local search over municipalities) **before any prompt was written or any model was run**.\n\n`;
md += `- Source lines: ${items.length + data.excluded.length} triage lines; ${data.excluded.length} excluded (no resolvable radar record, listed below); **${items.length} items split**.\n`;
md += `- Partition unit: the municipality (${cities.length} cities). Optim: ${sets.optim.length} items / ${new Set(sets.optim.map((i) => i.city)).size} cities. Blind: ${sets.blind.length} items / ${new Set(sets.blind.map((i) => i.city)).size} cities. No city appears in both sets.\n`;
md += `- Which half became \`blind\` was decided by a seeded coin flip after the balance search.\n`;
md += `- Frozen: \`optim.jsonl\` sha256 \`${shas.optim}\`; \`blind.jsonl\` sha256 \`${shas.blind}\` (see \`SHA256SUMS\`).\n\n`;
md += `Test per stratum: chi-square test of independence (set x category). A high p-value means no detectable imbalance. With ~60 items per side, several categories have expected counts below 5, so the chi-square p-value is indicative only; the max absolute share gap is given as a plain balance metric.\n\n`;
md += `| Stratum | Categories | chi² | df | p-value | Cramér's V | min expected | max share gap |\n|---|---:|---:|---:|---:|---:|---:|---:|\n`;
const detail = [];
const summary = {};
for (const [s, f] of Object.entries(STRATA)) {
  const o = cats[s].map((c) => sets.optim.filter((i) => f(i) === c).length);
  const b = cats[s].map((c) => sets.blind.filter((i) => f(i) === c).length);
  const t = chi2Test([o, b]);
  const gap = Math.max(...cats[s].map((_, j) => Math.abs(o[j] / sets.optim.length - b[j] / sets.blind.length)));
  summary[s] = { ...t, maxShareGap: gap };
  md += `| ${s} | ${cats[s].length} | ${t.chi2.toFixed(2)} | ${t.df} | ${t.p.toFixed(3)} | ${t.cramerV.toFixed(3)} | ${t.minExpected.toFixed(1)} | ${(100 * gap).toFixed(1)} pts |\n`;
  let d = `\n### ${s}\n\n| Category | optim | optim share | blind | blind share | total |\n|---|---:|---:|---:|---:|---:|\n`;
  cats[s].forEach((c, j) => { d += `| ${c} | ${o[j]} | ${pct(o[j], sets.optim.length)} | ${b[j]} | ${pct(b[j], sets.blind.length)} | ${o[j] + b[j]} |\n`; });
  detail.push(d);
}
md += `\n## Per-stratum tables\n${detail.join('')}`;
md += `\n## Verdict by pass (both sets)\n\n| Pass | optim P / S / N | blind P / S / N |\n|---|---|---|\n`;
for (const p of ['pass1', 'pass2', 'pass3']) {
  const f = (list) => VERDICTS.map((v) => list.filter((i) => i.label.pass === p && i.label.verdict === v).length).join(' / ');
  md += `| ${p} | ${f(sets.optim)} | ${f(sets.blind)} |\n`;
}
md += `\n## Excluded lines (not split, not scored)\n\n| Excel row | City | Verdict | Motif | Pass | Reason |\n|---:|---|---|---|---|---|\n`;
for (const e of data.excluded) md += `| ${e.excelRow} | ${e.city} | ${e.verdict} | ${e.motif} | ${e.pass} | ${e.reason} |\n`;
md += `\n## Partition unit and its cost\n\nGrouping by municipality is stricter than grouping by dossier (D10 asks that every unit of a dossier stay in one partition). It removes leakage through twin records (\`signal-\` / \`event-\` of the same act), coupled bylaws (plan + zoning concordance of the same session) and city-specific wording. The cost is that "city" cannot be balanced item-by-item; it is balanced instead through region and city-size strata.\n`;
fs.writeFileSync(path.join(ROOT, 'split-balance.md'), md);
fs.writeFileSync(path.join(ROOT, 'split-manifest.json'), JSON.stringify({
  createdAt: new Date().toISOString(), seed: SEED, restarts: RESTARTS, partitionUnit: 'municipality', weights: WEIGHT,
  blindChosenBy: 'seeded coin flip after balance search', source: data.source, lengthTerciles: data.lengthTerciles,
  counts: { optim: sets.optim.length, blind: sets.blind.length, excluded: data.excluded.length },
  sha256: shas, balance: summary,
}, null, 1));
console.log(JSON.stringify({ optim: sets.optim.length, blind: sets.blind.length, cost: bestCost, sha: shas, minP: Math.min(...Object.values(summary).map((x) => x.p)) }));
