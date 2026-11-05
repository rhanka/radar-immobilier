#!/usr/bin/env node
// make classif-l3b-split ENV=preprod CLASSIF_SEED=<seed> — reference-set split (plan v3 D2).
//
//  50/50 grouped by city: no city in both halves. Stratified on kind (signal/PV), pass-1
//  majority verdict and B′ pass (PVs form their own 'pv' stratum — the B′ stratum is undefined
//  for them, review §B-2). Greedy city assignment balancing every stratum; balance report with
//  counts and χ² per stratum (df = 1, even expectation); sha256 of both halves.
//
//  The seed is committed in the repo manifest BEFORE the draw: the manifest is first written
//  with {seed, committedAt}, read back, and only the read-back seed drives the assignment.
//  No model call. The halves lists (item ids only, no labels) are committed; the blind-half
//  seal (inputs + expected, CLASSIF_BLIND_KEY) happens in make classif-l3b-reference, after
//  the blind half is cross-reviewed under the frozen guide.
import path from 'node:path';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from '../lib/render.mjs';
import { chiSquareHalves } from '../l4/metrics.mjs';
import { CLASSIF_DIR, classifHome } from '../lib/paths.mjs';
import { loadDevItems } from '../l2/run.mjs';

export const bpassOf = (item, signalPass) => (item.kind === 'pv' ? 'pv' : signalPass.get(item.itemId) ?? 'unknown');

/** City-grouped greedy 50/50: sort cities by size desc, assign each to the half that best
    balances every stratum (sum of squared deviations to half-targets). Deterministic. */
export function splitGrouped(cities, targets) {
  const tuning = new Set();
  const blind = new Set();
  const counts = { tuning: new Map(), blind: new Map() };
  const score = (half, adds) => {
    let s = 0;
    for (const [k, target] of targets) {
      const c = (counts[half].get(k) ?? 0) + (adds.get(k) ?? 0);
      s += (c - target) ** 2;
    }
    return s;
  };
  const ordered = [...cities].sort((a, b) => b.items.length - a.items.length || (a.city < b.city ? -1 : 1));
  for (const city of ordered) {
    const adds = new Map();
    for (const it of city.items) adds.set(it.stratum, (adds.get(it.stratum) ?? 0) + 1);
    const st = score('tuning', adds);
    const sb = score('blind', adds);
    const pick = st < sb ? 'tuning' : sb < st ? 'blind' : tuning.size <= blind.size ? 'tuning' : 'blind';
    for (const it of city.items) {
      (pick === 'tuning' ? tuning : blind).add(it.id);
      counts[pick].set(it.stratum, (counts[pick].get(it.stratum) ?? 0) + 1);
    }
  }
  return { tuning: [...tuning].sort(), blind: [...blind].sort() };
}

export function stratumOf(kind, verdict, bpass) {
  return `${kind}|${verdict}|${bpass}`;
}

export async function main(argv = process.argv.slice(2)) {
  const seed = argv.includes('--seed') ? argv[argv.indexOf('--seed') + 1] : process.env.CLASSIF_SEED;
  if (!seed) { process.stderr.write('classif-l3b-split: refusing without a seed (pass CLASSIF_SEED=<seed>)\n'); process.exit(2); }
  const home = classifHome();
  const manifestFile = path.join(CLASSIF_DIR, 'l3', 'manifests', 'split.json');
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  // Seed committed BEFORE the draw; the draw reads back exactly this value.
  writeFileSync(manifestFile, `${JSON.stringify({ kind: 'split-seed', seed, committedAt: new Date().toISOString(), llmCalls: 0 }, null, 1)}\n`);
  const committed = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (committed.seed !== seed) throw new Error('split seed changed between commit and draw');
  void seed;

  const items = loadDevItems(home);
  const conv1 = JSON.parse(readFileSync(path.join(home, 'l2', 'converge-pass1.json'), 'utf8'));
  const verdictOf = new Map((conv1.rows ?? []).map((r) => [r.itemId, r.verdictMaj?.value ?? 'no-majority']));
  const sigManifest = JSON.parse(readFileSync(path.join(CLASSIF_DIR, 'l0', 'manifests', 'signal-draw-manifest.json'), 'utf8'));
  const signalPass = new Map(sigManifest.items.map((i) => [i.itemId, i.pass]));
  const byCity = new Map();
  for (const it of items) {
    const city = it.anchor.citySlug;
    const stratum = stratumOf(it.kind, verdictOf.get(it.itemId) ?? 'no-majority', bpassOf(it, signalPass));
    if (!byCity.has(city)) byCity.set(city, { city, items: [] });
    byCity.get(city).items.push({ id: it.itemId, stratum });
  }
  const totals = new Map();
  for (const { items: list } of byCity.values()) for (const it of list) totals.set(it.stratum, (totals.get(it.stratum) ?? 0) + 1);
  const targets = new Map([...totals].map(([k, v]) => [k, v / 2]));
  const halves = splitGrouped([...byCity.values()], targets);
  const inHalf = (ids) => new Set(ids);
  const t = inHalf(halves.tuning);
  const balance = [...totals.keys()].sort().map((s) => {
    let a = 0;
    let b = 0;
    for (const { items: list } of byCity.values()) {
      for (const it of list) {
        if (it.stratum !== s) continue;
        if (t.has(it.id)) a++; else b++;
      }
    }
    return { stratum: s, tuning: a, blind: b, ...chiSquareHalves(a, b) };
  });
  const body = (ids) => `${[...ids].sort().join('\n')}\n`;
  const manifest = { kind: 'split', seed: committed.seed, committedAt: committed.committedAt, drawnAt: new Date().toISOString(), llmCalls: 0,
    cities: byCity.size, halves,
    counts: { tuning: halves.tuning.length, blind: halves.blind.length,
      byKind: { tuning: {}, blind: {} }, byVerdict: { tuning: {}, blind: {} }, byBpass: { tuning: {}, blind: {} } },
    balance, chi2Total: balance.reduce((s, r) => s + r.chi2, 0),
    sha256: { tuning: sha256(body(halves.tuning)), blind: sha256(body(halves.blind)) } };
  for (const half of ['tuning', 'blind']) {
    for (const id of halves[half]) {
      const it = items.find((x) => x.itemId === id);
      const v = verdictOf.get(id) ?? 'no-majority';
      const bp = bpassOf(it, signalPass);
      manifest.counts.byKind[half][it.kind] = (manifest.counts.byKind[half][it.kind] ?? 0) + 1;
      manifest.counts.byVerdict[half][v] = (manifest.counts.byVerdict[half][v] ?? 0) + 1;
      manifest.counts.byBpass[half][bp] = (manifest.counts.byBpass[half][bp] ?? 0) + 1;
    }
  }
  // City-grouping invariant: no city in both halves.
  const citiesOf = (ids) => new Set(ids.map((id) => items.find((x) => x.itemId === id).anchor.citySlug));
  const overlap = [...citiesOf(halves.tuning)].filter((c) => citiesOf(halves.blind).has(c));
  if (overlap.length) throw new Error(`split refused: ${overlap.length} cities in both halves (${overlap.slice(0, 5).join(',')}…)`);
  manifest.cityOverlap = 0;
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify({ ...manifest, halves: { tuning: halves.tuning.length, blind: halves.blind.length } }, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l3', 'split.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l3b-split: ${err.stack}\n`); process.exit(1); });
}
