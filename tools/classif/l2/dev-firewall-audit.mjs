#!/usr/bin/env node
// make classif-l2-dev-firewall-audit [OUT=<dir>] ENV=preprod — MEASUREMENT ONLY (0 LLM call).
// Scans the frozen dev corpus ($CLASSIF_HOME/l0/dev-items.jsonl) with the current shared guard
// scanner (plan §C.4) against the committed guard material. The frozen corpus is never modified:
// every read here is read-only; the only write is the aggregated report in OUT (default
// $CLASSIF_HOME/recompute-972). The report holds aggregated counts only: no item text, no bylaw
// token and no shingle is ever printed (city slugs are guard-list metadata, reported as counts).
import path from 'node:path';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CLASSIF_DIR, classifHome } from '../lib/paths.mjs';
import { baseCity, scanShared, words } from '../lib/fingerprint.mjs';
import { bylawsIn, slugify } from '../lib/triage.mjs';
import { sha256 } from '../lib/render.mjs';
import { loadFingerprints } from '../lib/draw.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const shape = (t) => t.replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, 'A');
// Generic numbers the bylaw tokenizer also keeps (years, article numbers, short ids): 3–4 digits,
// optionally with one dot. Anything with a separator (-, /, .) beyond that, or a letter, counts
// as a bylaw-shaped token for option (a).
const isGenericNumber = (t) => /^\d{3,4}$/.test(t) || /^\d\.\d$/.test(t);

/** Excluded city slugs mentioned by the text (plaintext guard list, 1–6 word n-grams). */
function mentionedCities(text, excluded) {
  const w = words(text);
  const seen = new Set();
  const out = new Set();
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i + n <= w.length; i++) {
      const s = slugify(w.slice(i, i + n).join(' '));
      if (!seen.has(s)) { seen.add(s); if (excluded.has(s)) out.add(s); }
    }
  }
  return [...out];
}

export async function main() {
  const home = classifHome();
  const out = path.resolve(arg('--out', '') || path.join(home, 'recompute-972'));
  const { salt, fps } = loadFingerprints(home) ?? {};
  if (!salt) throw new Error(`refused: ${path.join(home, 'guard', 'fingerprints.json')} missing (fail closed)`);
  const excl = JSON.parse(readFileSync(path.join(home, 'guard', 'exclusions.json'), 'utf8'));
  const exclCities = new Set(excl.citySlugs.map(baseCity));
  const exclBylaws = new Set(excl.bylaws);

  const raw = readFileSync(path.join(home, 'l0', 'dev-items.jsonl'), 'utf8');
  const items = raw.trim().split('\n').map((l) => JSON.parse(l));
  const manifest = JSON.parse(readFileSync(path.join(CLASSIF_DIR, 'l0', 'manifests', 'draw-manifest.json'), 'utf8'));

  // Reference rows for the partition / Pertinent intersections (counts only, no text).
  const refRows = new Map(readFileSync(path.join(home, 'l3', 'dev-reference.jsonl'), 'utf8').trim().split('\n')
    .map((l) => JSON.parse(l)).map((r) => [r.itemId, { partition: r.partition, pertinent: r.verdict === 'pertinent' }]));

  const perList = {};
  const combos = {};
  const byKind = { signal: 0, pv: 0 };
  const anchorExcluded = { items: 0, signal: 0, pv: 0, byCity: {} };
  const mentions = { items: 0, byCity: {} };
  const byd = { items: 0, signal: 0, pv: 0, distinctTokens: new Set(), shapes: {}, onlyGeneric: 0, withReal: 0, onlyGenericIds: 0 };
  const sh = { items: 0, signal: 0, pv: 0 };
  const ns = { nodeIds: 0, docShas: 0 };
  let refused = 0;
  let narrowAdmissible = 0;
  const inter = { pertinent: { total: 0, refused: 0, combos: {}, narrow: 0 }, devCore: { total: 0, refused: 0, combos: {}, narrow: 0 }, devAmbiguous: { total: 0, refused: 0, combos: {}, narrow: 0 } };

  for (const it of items) {
    const hits = scanShared(salt, fps, it.input);
    const total = Object.values(hits).reduce((a, b) => a + b, 0);
    const ref = refRows.get(it.itemId);
    const pk = ref ? (ref.partition === 'dev-core' ? 'devCore' : 'devAmbiguous') : null;
    if (ref) {
      if (ref.pertinent) inter.pertinent.total++;
      inter[pk].total++;
    }
    if (!total) continue;
    refused++;
    byKind[it.kind]++;
    for (const [k, v] of Object.entries(hits)) if (v > 0) perList[k] = (perList[k] ?? 0) + 1;
    const combo = Object.entries(hits).filter(([, v]) => v > 0).map(([k]) => k).sort().join('+');
    combos[combo] = (combos[combo] ?? 0) + 1;
    if (hits.nodeIds) ns.nodeIds++;
    if (hits.docShas) ns.docShas++;
    if (hits.shingles) { sh.items++; sh[it.kind]++; }
    const anchorOut = exclCities.has(baseCity(it.anchor?.citySlug ?? ''));
    if (anchorOut) {
      anchorExcluded.items++;
      anchorExcluded[it.kind]++;
      const c = baseCity(it.anchor.citySlug);
      anchorExcluded.byCity[c] = (anchorExcluded.byCity[c] ?? 0) + 1;
    }
    for (const c of mentionedCities(it.input, exclCities)) mentions.byCity[c] = (mentions.byCity[c] ?? 0) + 1;
    // Option (a) estimate: refused ONLY by generic bylaw numbers (no city, shingle, node or doc hit).
    const narrow = hits.bylaws > 0 && !hits.citySlugs && !hits.shingles && !hits.nodeIds && !hits.docShas
      && !bylawsIn(it.input).filter((b) => exclBylaws.has(b)).some((t) => !isGenericNumber(t));
    if (narrow) narrowAdmissible++;
    if (hits.bylaws) {
      byd.items++;
      byd[it.kind]++;
      const tokens = bylawsIn(it.input).filter((b) => exclBylaws.has(b));
      for (const t of tokens) { byd.distinctTokens.add(t); byd.shapes[shape(t)] = (byd.shapes[shape(t)] ?? 0) + 1; }
      if (tokens.some((t) => !isGenericNumber(t))) byd.withReal++;
      else byd.onlyGeneric++;
    }
    if (ref) {
      if (ref.pertinent) { inter.pertinent.refused++; inter.pertinent.combos[combo] = (inter.pertinent.combos[combo] ?? 0) + 1; if (narrow) inter.pertinent.narrow++; }
      inter[pk].refused++;
      inter[pk].combos[combo] = (inter[pk].combos[combo] ?? 0) + 1;
      if (narrow) inter[pk].narrow++;
    }
  }
  mentions.items = new Set(items.filter((it) => mentionedCities(it.input, exclCities).length).map((it) => it.itemId)).size;

  const report = {
    kind: 'dev-firewall-audit', createdAt: new Date().toISOString(), llmCalls: 0,
    corpus: { items: items.length, signals: items.filter((i) => i.kind === 'signal').length, pvs: items.filter((i) => i.kind === 'pv').length,
      devItemsSha256: sha256(raw), manifest: { devItems: manifest.devItems, devItemsSha256: manifest.devItemsSha256 },
      manifestMatch: manifest.devItems === items.length && manifest.devItemsSha256 === sha256(raw) },
    guard: { cities: exclCities.size, nodeIds: excl.nodeIds.length, docShas: excl.docShas.length, bylaws: exclBylaws.size, shingles: fps.shingles.length },
    refused: { total: refused, signal: byKind.signal, pv: byKind.pv },
    refusedPerList: perList, refusedPerCombination: combos,
    anchorExcludedCity: { ...anchorExcluded, byCityCount: Object.keys(anchorExcluded.byCity).length },
    cityMentions: { itemsWithMention: mentions.items, distinctCities: Object.keys(mentions.byCity).length, byCity: mentions.byCity },
    bylaws: { items: byd.items, signal: byd.signal, pv: byd.pv, distinctExposedTokensMatched: byd.distinctTokens.size,
      tokenShapes: byd.shapes, itemsOnlyGeneric: byd.onlyGeneric, itemsWithRealToken: byd.withReal },
    shingles: { items: sh.items, signal: sh.signal, pv: sh.pv },
    nodeIdsDocShas: ns,
    intersections: inter,
    optionA: { admissibleIfOnlyGenericBylawNarrowed: narrowAdmissible, remainingRefused: refused - narrowAdmissible },
    note: 'Aggregated counts only: no item text, no bylaw token, no shingle is stored here.',
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'dev-firewall-audit.json'), `${JSON.stringify(report, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'dev-firewall-audit.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-dev-firewall-audit: ${err.stack}\n`); process.exit(1); });
}
