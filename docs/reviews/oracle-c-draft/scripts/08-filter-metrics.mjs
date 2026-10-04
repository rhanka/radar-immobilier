#!/usr/bin/env node
// Step 8 — filtering task "show to Steve or hide", precision / recall / F1, on the SAME lines for
// today's B filter combinations (no model) and for C prompts v1 / v2 (archived answers, no new
// model call). Unit = one Steve triage line attached to radar record(s). Truth = Steve's verdict.
// Two positive definitions: positive = Pertinent; positive = Pertinent or À surveiller.
// Writes results/filter-metrics-<set>.{md,json} and results/filter-pr-<set>.svg.
// Usage: node 08-filter-metrics.mjs --set optim|blind
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, WORK } from './lib/common.mjs';
import { rng } from './lib/stats.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const set = arg('set');
const items = fs.readFileSync(path.join(ROOT, `${set}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const nodes = new Map(JSON.parse(fs.readFileSync(path.join(WORK, 'nodes.json'), 'utf8')).nodes.map((n) => [n.id, n]));
const props = (i) => i.nodeIds.map((id) => nodes.get(id)?.props?.properties ?? {});
const VERD = new Set(['Pertinent', 'À surveiller', 'Non pertinent']);

// ---- systems: id -> (item) => true (shown) | false (hidden) | undefined (not available) ----
const systems = [];
const add = (key, label, family, fn, note = '') => systems.push({ key, label, family, fn, note });

// Today's B, observed: the passes Steve ran on the deployed radar (2026-09-15..21).
add('b-pass1', 'B pass 1 (5 filters)', 'B observed', (i) => i.label.pass === 'pass1');
add('b-pass2', 'B pass 2 (no Précoce)', 'B observed', (i) => i.label.pass === 'pass1' || i.label.pass === 'pass2');
add('b-pass3', 'B pass 3 (no filter)', 'B observed', () => true);
// Single filters, reconstructed from the record properties read on 2026-10-04 (approximation).
const has = (i, re) => props(i).some((p) => [p.etape, p.category, p.instrument, p.kind].some((v) => re.test(String(v ?? ''))));
add('f-precoce', 'Précoce alone (reconstructed)', 'B reconstructed', (i) => props(i).some((p) => ['avis_motion', 'projet_reglement'].includes(p.etape)),
  'etape ∈ {avis_motion, projet_reglement} on any record of the line');
add('f-zonage', 'Zonage alone (reconstructed)', 'B reconstructed', (i) => props(i).some((p) => ['rezonage', 'modification_zonage', 'densification', 'refonte_reglementaire', 'plan_urbanisme'].includes(p.category ?? '')),
  'category ∈ {rezonage, modification_zonage, densification, refonte, plan d\'urbanisme}; densification_residentielle excluded as in the code');
add('f-excl', 'Exclude PIIA + dérogation alone (reconstructed)', 'B reconstructed', (i) => !has(i, /piia|derogation/i),
  'hides any record typed piia or dérogation (the code keeps a PIIA with residential proof: not reproducible here)');

function loadRuns(pv, model) {
  const f = path.join(ROOT, 'runs', set, pv, `${model}.jsonl`);
  if (!fs.existsSync(f)) return null;
  const m = new Map();
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.parsed) m.set(r.id, r.parsed.verdict); }
  return m;
}
const MODELS = [['astra', 'Astra low'], ['gemini', 'Gemini low'], ['opus', 'Opus 5.5 low']];
for (const pv of ['v1', 'v2']) {
  const runs = Object.fromEntries(MODELS.map(([k]) => [k, loadRuns(pv, k)]));
  for (const [k, lab] of MODELS) {
    const r = runs[k];
    add(`c-${pv}-${k}`, `C ${pv} ${lab}`, `C ${pv}`, r ? (i) => { const v = r.get(i.id); return VERD.has(v) ? v !== 'Non pertinent' : true; } : () => undefined,
      r ? '' : `not run on ${set} (blind is measured once, with the frozen final prompt only)`);
  }
  if (pv === 'v2' && MODELS.every(([k]) => runs[k])) {
    add('c-v2-maj', 'C v2 majority of 3', 'C v2', (i) => {
      const vs = MODELS.map(([k]) => runs[k].get(i.id));
      return vs.filter((v) => v === 'Non pertinent').length < 2;
    });
    for (const [k, lab] of MODELS) {
      add(`c-v2s-${k}`, `C v2 strict ${lab} (shows Pertinent only)`, 'C v2 strict', (i) => runs[k].get(i.id) === 'Pertinent');
    }
  }
}

// ---- metrics with municipality-clustered bootstrap ----
const POS = { P: (i) => i.label.verdict === 'Pertinent', PS: (i) => i.label.verdict !== 'Non pertinent' };
function counts(list, show, pos) {
  let tp = 0; let fp = 0; let fn = 0; let tn = 0;
  for (const i of list) { const s = show(i); const p = pos(i); if (s && p) tp++; else if (s) fp++; else if (p) fn++; else tn++; }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, tn, precision, recall, f1 };
}
const cities = [...new Set(items.map((i) => i.city))];
const byCity = Object.fromEntries(cities.map((c) => [c, items.filter((i) => i.city === c)]));
function ci(show, pos, key) {
  const r = rng(808);
  const acc = { precision: [], recall: [], f1: [] };
  for (let b = 0; b < 2000; b++) {
    const s = []; for (let k = 0; k < cities.length; k++) s.push(...byCity[cities[Math.floor(r() * cities.length)]]);
    const c = counts(s, show, pos);
    for (const m of Object.keys(acc)) if (c[m] != null) acc[m].push(c[m]);
  }
  const q = (a) => { a.sort((x, y) => x - y); return a.length ? [a[Math.floor(0.025 * a.length)], a[Math.floor(0.975 * a.length)]] : [null, null]; };
  return { precision: q(acc.precision), recall: q(acc.recall), f1: q(acc.f1), key };
}

const report = { set, n: items.length, municipalities: cities.length, systems: [] };
for (const s of systems) {
  if (items.some((i) => s.fn(i) === undefined)) { report.systems.push({ key: s.key, label: s.label, family: s.family, available: false, note: s.note }); continue; }
  const shown = items.filter(s.fn).length;
  const out = { key: s.key, label: s.label, family: s.family, available: true, note: s.note, shown };
  for (const [pk, pos] of Object.entries(POS)) out[pk] = { ...counts(items, s.fn, pos), ci95: ci(s.fn, pos) };
  out.noise = shown ? out.PS.fp / shown : null; // Steve-"Non pertinent" among shown
  out.pertinentLost = out.P.fn;
  report.systems.push(out);
}
// Agreement of the reconstructed Précoce with the observed pass 1 / pass 2 split (sanity check).
const p12 = items.filter((i) => i.label.pass !== 'pass3');
report.precoceSanity = { linesPass1or2: p12.length, reconstructedPrecoceMatchesPass1: p12.filter((i) => systems.find((s) => s.key === 'f-precoce').fn(i) === (i.label.pass === 'pass1')).length };

fs.writeFileSync(path.join(ROOT, 'results', `filter-metrics-${set}.json`), JSON.stringify(report, null, 1));

// ---- markdown ----
const f = (x) => (x == null ? 'N-A' : `${(100 * x).toFixed(1)}`);
const fci = (v, c) => (v == null ? 'N-A' : `${f(v)} [${f(c[0])}–${f(c[1])}]`);
const P = report.systems.filter((s) => s.available);
const nP = items.filter(POS.P).length; const nPS = items.filter(POS.PS).length;
let md = `### ${set} — ${items.length} lines, ${cities.length} municipalities (Steve: ${nP} Pertinent, ${nPS - nP} À surveiller, ${items.length - nPS} Non pertinent)\n\n`;
md += `Values in %, municipality-clustered bootstrap 95 % interval in brackets (2000 draws, seed 808).\n\n`;
for (const [pk, title] of [['P', 'Positive = Pertinent'], ['PS', 'Positive = Pertinent or À surveiller']]) {
  md += `**${title}**\n\n| System | Shown | TP | FP | FN | TN | Precision | Recall | F1 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const s of P) { const m = s[pk]; md += `| ${s.label} | ${s.shown} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} | ${fci(m.precision, m.ci95.precision)} | ${fci(m.recall, m.ci95.recall)} | ${fci(m.f1, m.ci95.f1)} |\n`; }
  md += '\n';
}
md += `**Summary** (noise = Steve-"Non pertinent" among shown lines; Pertinent lost = Steve-Pertinent hidden)\n\n| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
for (const s of report.systems) {
  if (!s.available) { md += `| ${s.label} | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A — ${s.note} |\n`; continue; }
  md += `| ${s.label} | ${f(s.P.precision)} | ${f(s.P.recall)} | ${f(s.P.f1)} | ${f(s.PS.precision)} | ${f(s.PS.recall)} | ${f(s.PS.f1)} | ${f(s.noise)} | ${s.pertinentLost}/${nP} |\n`;
}
md += `\nReconstructed filters (approximation from 2026-10-04 record properties, \`non vérifié\` against the code deployed in September):\n`;
for (const s of systems.filter((x) => x.family === 'B reconstructed')) md += `- ${s.label}: ${s.note}.\n`;
md += `- Résidentiel alone: N-A — it depends on residential markers computed by the code, not stored in the record properties.\n`;
md += `- Sanity check: on the ${report.precoceSanity.linesPass1or2} lines of pass 1 or 2, the reconstructed Précoce agrees with the observed pass on ${report.precoceSanity.reconstructedPrecoceMatchesPass1}.\n`;
fs.writeFileSync(path.join(ROOT, 'results', `filter-metrics-${set}.md`), md);

// ---- SVG: grouped bars precision / recall (positive = Pertinent) ----
const rows = P.filter((s) => !s.key.startsWith('c-v2s-'));
const W = 860; const rowH = 34; const left = 340; const top = 54; const H = top + rows.length * rowH + 40;
const x = (v) => left + v * (W - left - 50);
const BLUE = '#2a78d6'; const ORANGE = '#eb6834';
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">\n`;
svg += `<title>Precision and recall, positive = Pertinent, ${set} set</title>\n<rect width="${W}" height="${H}" fill="#fcfcfb"/>\n`;
svg += `<text x="16" y="22" font-size="14" font-weight="600" fill="#1a1a19">Show-to-Steve filter, ${set} (${items.length} lines): precision and recall, positive = Pertinent</text>\n`;
svg += `<rect x="16" y="32" width="10" height="10" rx="2" fill="${BLUE}"/><text x="30" y="41" fill="#52514e">Precision</text><rect x="100" y="32" width="10" height="10" rx="2" fill="${ORANGE}"/><text x="114" y="41" fill="#52514e">Recall</text>\n`;
for (const t of [0, 0.25, 0.5, 0.75, 1]) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - 34}" stroke="#e1e0d9"/><text x="${x(t)}" y="${H - 20}" text-anchor="middle" fill="#52514e">${t * 100}%</text>\n`;
rows.forEach((s, k) => {
  const y = top + k * rowH;
  svg += `<text x="${left - 8}" y="${y + 17}" text-anchor="end" fill="#1a1a19">${s.label.replace(/&/g, '&amp;')}</text>\n`;
  const bars = [[s.P.precision, BLUE, 2], [s.P.recall, ORANGE, 16]];
  for (const [v, col, dy] of bars) {
    const w = Math.max(0, x(v ?? 0) - left);
    svg += `<rect x="${left}" y="${y + dy}" width="${w}" height="12" rx="3" fill="${col}"><title>${s.label}: ${col === BLUE ? 'precision' : 'recall'} ${f(v)} %</title></rect><text x="${left + w + 4}" y="${y + dy + 10}" fill="#52514e" font-size="11">${f(v)}</text>\n`;
  }
});
svg += '</svg>\n';
fs.writeFileSync(path.join(ROOT, 'results', `filter-pr-${set}.svg`), svg);
console.log(`${set}: ${report.systems.length} systems written`);
