#!/usr/bin/env node
// Step 6 — score model runs against Steve's verdicts (metrics frozen before the first run).
// Usage: node 06-score.mjs --set optim|blind --prompt v1 [--json out.json] [--md out.md] [--errors]
// --errors prints per-item disagreements (refused on blind: blind errors are never inspected).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, VERDICTS, VSHORT, MOTIF_FAMILY } from './lib/common.mjs';
import { cohenKappa, fleissKappa, wilson } from './lib/stats.mjs';
import { MODELS } from './lib/models.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const set = arg('set'); const pv = arg('prompt');
const showErrors = process.argv.includes('--errors');
if (showErrors && set === 'blind') { console.error('--errors refused on blind'); process.exit(3); }

const items = fs.readFileSync(path.join(ROOT, `${set}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const gold = new Map(items.map((i) => [i.id, i.label]));
const norm = (v) => {
  const s = String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.startsWith('pertinent')) return 'Pertinent';
  if (s.startsWith('a surveiller')) return 'À surveiller';
  if (s.startsWith('non pertinent')) return 'Non pertinent';
  return null;
};

function load(model) {
  const f = path.join(ROOT, 'runs', set, pv, `${model}.jsonl`);
  if (!fs.existsSync(f)) return null;
  const last = new Map();
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.parsed || !last.has(r.id)) last.set(r.id, r);
  }
  return last;
}

const pctl = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const shown = (v) => v === 'Pertinent' || v === 'À surveiller'; // C default view hides only "Non pertinent"

function metrics(pred) {
  // pred: Map id -> verdict|null (null = refused/unparsable, counted as an error and as "shown" by asymmetry)
  const ids = items.map((i) => i.id);
  const conf = Object.fromEntries(VERDICTS.map((g) => [g, Object.fromEntries([...VERDICTS, 'invalid'].map((p) => [p, 0]))]));
  let correct = 0;
  for (const id of ids) { const g = gold.get(id).verdict; const p = pred.get(id) ?? 'invalid'; conf[g][p]++; if (p === g) correct++; }
  const n = ids.length;
  const perClass = {};
  for (const c of VERDICTS) {
    const tp = conf[c][c];
    const predC = VERDICTS.reduce((s, g) => s + conf[g][c], 0);
    const goldC = Object.values(conf[c]).reduce((a, b) => a + b, 0);
    perClass[c] = { precision: predC ? tp / predC : null, recall: goldC ? tp / goldC : null, support: goldC, predicted: predC };
  }
  const isShown = (id) => { const p = pred.get(id); return p == null ? true : shown(p); };
  const shownIds = ids.filter(isShown);
  const noise = shownIds.filter((id) => gold.get(id).verdict === 'Non pertinent').length;
  const goldP = ids.filter((id) => gold.get(id).verdict === 'Pertinent');
  const goldUseful = ids.filter((id) => gold.get(id).verdict !== 'Non pertinent');
  const goldN = ids.filter((id) => gold.get(id).verdict === 'Non pertinent');
  return {
    n, accuracy: correct / n, accuracyCI95: wilson(correct, n), confusion: conf, perClass,
    view: {
      shown: shownIds.length,
      noiseShown: noise,
      noiseRate: shownIds.length ? noise / shownIds.length : null,
      pertinentKeptVisible: goldP.filter(isShown).length,
      pertinentTotal: goldP.length,
      pertinentHidden: goldP.filter((id) => !isShown(id)).length,
      usefulHidden: goldUseful.filter((id) => !isShown(id)).length,
      noiseRemoved: goldN.filter((id) => !isShown(id)).length,
      noiseTotal: goldN.length,
    },
  };
}

const report = { set, promptVersion: pv, n: items.length, models: {}, baselineB: null, interModel: null, ensemble: null };

// Baseline B on the same items: B's default view = pass 1 (five filters). Not a model: the filters Steve used.
{
  const pred = new Map(items.map((i) => [i.id, i.label.pass === 'pass1' ? 'Pertinent' : 'Non pertinent']));
  const m = metrics(pred);
  report.baselineB = { note: 'B default view = pass 1 lines; only view metrics are meaningful', view: m.view };
}

const loaded = {};
for (const key of Object.keys(MODELS)) {
  const runs = load(key);
  if (!runs) continue;
  loaded[key] = runs;
  const pred = new Map(items.map((i) => [i.id, norm(runs.get(i.id)?.parsed?.verdict)]));
  const m = metrics(pred);
  let motifExact = 0; let motifFamily = 0; let motifCodeValid = 0;
  for (const i of items) {
    const p = runs.get(i.id)?.parsed?.motif;
    if (p && MOTIF_FAMILY[p]) motifCodeValid++;
    if (p === i.label.motif) motifExact++;
    if (p && MOTIF_FAMILY[p] && MOTIF_FAMILY[p] === i.label.motifFamily) motifFamily++;
  }
  const recs = items.map((i) => runs.get(i.id)).filter(Boolean);
  const lat = recs.map((r) => r.latencyMs).filter((x) => typeof x === 'number');
  const tok = (r, k) => Number(r.usage?.[k] ?? 0);
  const sum = (k) => recs.reduce((s, r) => s + tok(r, k), 0);
  report.models[key] = {
    label: MODELS[key].label, model: MODELS[key].model, effort: MODELS[key].effort, route: MODELS[key].route,
    answered: recs.filter((r) => r.parsed).length, invalidVerdict: items.filter((i) => pred.get(i.id) == null).length,
    ...m,
    motif: { exact: motifExact / items.length, family: motifFamily / items.length, validCode: motifCodeValid / items.length },
    latency: { p50Ms: pctl(lat, 0.5), p90Ms: pctl(lat, 0.9), meanMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null },
    tokens: {
      input: sum('input_tokens') + sum('cache_creation_input_tokens') + sum('cache_read_input_tokens'),
      output: sum('output_tokens'),
      reasoning: sum('reasoning_output_tokens') + sum('thinking_tokens'),
    },
    costUsdApiEquivalent: recs.some((r) => r.costUsdApiEquivalent != null) ? recs.reduce((s, r) => s + (r.costUsdApiEquivalent ?? 0), 0) : null,
  };
  if (showErrors) {
    for (const i of items) {
      const r = runs.get(i.id); const p = pred.get(i.id);
      if (p !== i.label.verdict) {
        console.log(`[${key}] ${i.id} gold=${VSHORT[i.label.verdict]}/${i.label.motif} pred=${p ? VSHORT[p] : 'invalid'}/${r?.parsed?.motif ?? '-'} :: ${r?.parsed?.justification ?? r?.rawText?.slice(0, 200) ?? ''}`);
      }
    }
  }
}

const keys = Object.keys(loaded);
if (keys.length >= 2) {
  const verdictOf = (k, id) => norm(loaded[k].get(id)?.parsed?.verdict);
  const pairs = {};
  for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
    pairs[`${keys[a]}~${keys[b]}`] = cohenKappa(items.map((i) => verdictOf(keys[a], i.id)), items.map((i) => verdictOf(keys[b], i.id)), VERDICTS);
  }
  const rows = items.map((i) => keys.map((k) => verdictOf(k, i.id)));
  const unanimous = rows.filter((r) => r.every((x) => x != null && x === r[0])).length;
  report.interModel = { pairwise: pairs, fleiss: keys.length >= 3 ? fleissKappa(rows, VERDICTS) : null, unanimous, unanimousRate: unanimous / items.length };
  if (keys.length >= 3) {
    // Majority vote; a three-way split resolves to "À surveiller" (keeps the signal visible).
    const pred = new Map(items.map((i, idx) => {
      const r = rows[idx]; const c = {};
      for (const v of r) if (v) c[v] = (c[v] ?? 0) + 1;
      const top = Object.entries(c).sort((x, y) => y[1] - x[1])[0];
      return [i.id, top && top[1] >= 2 ? top[0] : 'À surveiller'];
    }));
    const m = metrics(pred);
    report.ensemble = { rule: 'majority of 3; no majority -> À surveiller', accuracy: m.accuracy, accuracyCI95: m.accuracyCI95, perClass: m.perClass, view: m.view, confusion: m.confusion };
    // Steve-N items: how many does a unanimous "Non pertinent" vote remove?
  }
}

const out = arg('json');
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
const f = (x) => (x == null ? 'N-A' : `${(100 * x).toFixed(1)} %`);
const lines = [];
lines.push(`### ${set} — prompt ${pv} (n = ${items.length})\n`);
lines.push('| Metric | B (pass 1) | ' + keys.map((k) => MODELS[k].label).join(' | ') + (report.ensemble ? ' | Majority of 3 |' : ' |'));
lines.push('|---|---:|' + keys.map(() => '---:').join('|') + (report.ensemble ? '|---:|' : '|'));
const row = (name, bVal, fn, ensVal) => lines.push(`| ${name} | ${bVal} | ${keys.map((k) => fn(report.models[k])).join(' | ')}${report.ensemble ? ` | ${ensVal}` : ''} |`);
const bv = report.baselineB.view; const ev = report.ensemble?.view;
row('Verdict accuracy (3 classes)', 'N-A', (m) => `${f(m.accuracy)} [${f(m.accuracyCI95[0])}–${f(m.accuracyCI95[1])}]`, ev ? f(report.ensemble.accuracy) : '');
for (const c of VERDICTS) {
  row(`${c} precision / recall`, 'N-A', (m) => `${f(m.perClass[c].precision)} / ${f(m.perClass[c].recall)}`, ev ? `${f(report.ensemble.perClass[c].precision)} / ${f(report.ensemble.perClass[c].recall)}` : '');
}
row('Default view: lines shown', `${bv.shown}`, (m) => `${m.view.shown}`, ev ? `${ev.shown}` : '');
row('Noise rate in view (Non pertinent shown / shown)', `${f(bv.noiseRate)} (${bv.noiseShown}/${bv.shown})`, (m) => `${f(m.view.noiseRate)} (${m.view.noiseShown}/${m.view.shown})`, ev ? `${f(ev.noiseRate)} (${ev.noiseShown}/${ev.shown})` : '');
row('Pertinent kept visible', `${bv.pertinentKeptVisible}/${bv.pertinentTotal}`, (m) => `${m.view.pertinentKeptVisible}/${m.view.pertinentTotal}`, ev ? `${ev.pertinentKeptVisible}/${ev.pertinentTotal}` : '');
row('Useful (P or S) hidden', `${bv.usefulHidden}`, (m) => `${m.view.usefulHidden}`, ev ? `${ev.usefulHidden}` : '');
row('Noise removed', `${bv.noiseRemoved}/${bv.noiseTotal}`, (m) => `${m.view.noiseRemoved}/${m.view.noiseTotal}`, ev ? `${ev.noiseRemoved}/${ev.noiseTotal}` : '');
row('Motif exact / family', 'N-A', (m) => `${f(m.motif.exact)} / ${f(m.motif.family)}`, '');
row('Invalid or missing verdicts', 'N-A', (m) => `${m.invalidVerdict}`, '');
row('Latency p50 / p90 (s)', 'N-A', (m) => `${(m.latency.p50Ms / 1000).toFixed(1)} / ${(m.latency.p90Ms / 1000).toFixed(1)}`, '');
row('Tokens in / out (total)', 'N-A', (m) => `${m.tokens.input} / ${m.tokens.output}`, '');
if (report.interModel) {
  lines.push('\nInter-model agreement on the verdict: ' + Object.entries(report.interModel.pairwise).map(([k, v]) => `${k} κ = ${v.kappa?.toFixed(2)} (agreement ${f(v.agreement)})`).join('; ')
    + (report.interModel.fleiss ? `; Fleiss κ = ${report.interModel.fleiss.kappa?.toFixed(2)}` : '') + `; unanimous on ${report.interModel.unanimous}/${items.length}.`);
}
for (const k of keys) {
  const c = report.models[k].confusion;
  lines.push(`\nConfusion — ${MODELS[k].label} (rows = Steve, columns = model):\n\n| Steve \\ model | P | S | N | invalid |\n|---|---:|---:|---:|---:|`);
  for (const g of VERDICTS) lines.push(`| ${g} | ${c[g].Pertinent} | ${c[g]['À surveiller']} | ${c[g]['Non pertinent']} | ${c[g].invalid} |`);
}
const md = lines.join('\n') + '\n';
const mdOut = arg('md');
if (mdOut) fs.writeFileSync(mdOut, md);
if (!showErrors) process.stdout.write(md);
