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
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from '../lib/render.mjs';
import { chiSquareHalves } from '../l4/metrics.mjs';
import { classifDir, repoRoot, classifHome } from '../lib/paths.mjs';
import { ANNOTATORS, loadDevItems } from '../l2/run.mjs';

export const bpassOf = (item, signalPass) => (item.kind === 'pv' ? 'pv' : signalPass.get(item.itemId) ?? 'unknown');

/** FNV-1a 32-bit of the seed string → mulberry32 PRNG. Real seeded draw: the same committed
    seed always reproduces the same halves; a different seed draws differently. */
export function seededRng(seedString) {
  let h = 0x811c9dc5;
  for (const ch of String(seedString)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSeeded(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** City-grouped greedy 50/50: sort cities by size desc, assign each city to the half
    that minimises the TOTAL imbalance increase. With an rng the input order is
    shuffled (stable sort keeps the shuffled order within equal sizes) and delta ties
    break randomly — the draw is reproducible from the seed. Without rng the legacy
    deterministic order applies (tests). */
export function splitGrouped(cities, targets, rng = null) {
  const tuning = new Set();
  const blind = new Set();
  const counts = { tuning: new Map(), blind: new Map() };
  // Global size term: the halves stay near N/2 via a synthetic `__all__` stratum
  // (target N/2) fed with each city's size alongside its per-stratum counts.
  const withAll = new Map(targets);
  withAll.set('__all__', cities.reduce((s, c) => s + c.items.length, 0) / 2);
  // Total imbalance increase of assigning `adds` to `half`:
  // Δ = Σₖ[(cₖ + aₖ − Tₖ)² − (cₖ − Tₖ)²], over the touched strata plus `__all__`.
  // Strata the city does not touch contribute 0 (aₖ = 0), so unlike the former
  // per-half absolute-score comparison the leading half cannot win by default.
  const delta = (half, adds) => {
    let d = 0;
    const cur = counts[half];
    for (const [k, a] of adds) {
      const target = withAll.get(k) ?? 0;
      const c = cur.get(k) ?? 0;
      d += (c + a - target) ** 2 - (c - target) ** 2;
    }
    return d;
  };
  const base = rng ? shuffleSeeded(cities, rng) : [...cities];
  // Review §3a: with a seed the shuffled order decides equal sizes (stable sort on size
  // alone); without rng the legacy deterministic alphabetical tie-break applies (tests).
  const ordered = rng
    ? base.sort((a, b) => b.items.length - a.items.length)
    : base.sort((a, b) => b.items.length - a.items.length || (a.city < b.city ? -1 : 1));
  for (const city of ordered) {
    const adds = new Map();
    for (const it of city.items) adds.set(it.stratum, (adds.get(it.stratum) ?? 0) + 1);
    adds.set('__all__', city.items.length);
    const dt = delta('tuning', adds);
    const db = delta('blind', adds);
    const pick = dt < db ? 'tuning' : db < dt ? 'blind' : rng ? (rng() < 0.5 ? 'tuning' : 'blind') : tuning.size <= blind.size ? 'tuning' : 'blind';
    for (const it of city.items) {
      (pick === 'tuning' ? tuning : blind).add(it.id);
      counts[pick].set(it.stratum, (counts[pick].get(it.stratum) ?? 0) + 1);
    }
    counts[pick].set('__all__', (counts[pick].get('__all__') ?? 0) + city.items.length);
  }
  return { tuning: [...tuning].sort(), blind: [...blind].sort() };
}

/** The seed must be committed in the repo BEFORE the draw: the seed file must be tracked
    and clean (git ls-files + git diff --quiet HEAD). Returns the committed seed. */
export function requireCommittedSeed(seedFile, cliSeed) {
  const root = repoRoot(process.env);
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  if (!existsSync(seedFile)) throw new Error(`split refused: seed file ${seedFile} absent (commit it before the draw)`);
  const rel = path.relative(root, seedFile);
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`split refused: seed file ${rel} is not committed`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`split refused: seed file ${rel} differs from the committed version (commit before the draw)`);
  const committed = JSON.parse(readFileSync(seedFile, 'utf8'));
  if (!committed.seed) throw new Error(`split refused: seed file ${rel} carries no seed`);
  if (cliSeed && cliSeed !== committed.seed) throw new Error('split refused: --seed differs from the committed seed file');
  return committed;
}

/** The consumed split must be committed BEFORE any pass ≥ 2: tracked and clean
    (git ls-files + git diff --quiet HEAD), same guard as the seed. Returns the split.
    Review D1/D2: hermetic tests redirect via CLASSIF_REPO in test mode only. */
export function requireCommittedSplit(splitFile = null, repo = null) {
  const env = process.env;
  const file = splitFile ?? path.join(classifDir(env), 'l3', 'manifests', 'split.json');
  const root = repo ?? repoRoot(env);
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  if (!existsSync(file)) throw new Error(`split refused: ${file} absent (run make classif-l3b-split first)`);
  const rel = path.relative(root, file);
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`split refused: ${rel} is not committed (commit the draw before any pass ≥ 2)`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`split refused: ${rel} differs from the committed version (commit before any pass ≥ 2)`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function stratumOf(kind, verdict, bpass) {
  return `${kind}|${verdict}|${bpass}`;
}

export async function main(argv = process.argv.slice(2)) {
  const cliSeed = argv.includes('--seed') ? argv[argv.indexOf('--seed') + 1] : process.env.CLASSIF_SEED;
  const home = classifHome();
  const root = repoRoot(process.env);
  const manifestFile = path.join(classifDir(process.env), 'l3', 'manifests', 'split.json');
  const seedFile = path.join(classifDir(process.env), 'l3', 'manifests', 'split-seed.json');
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  // Review §3: refuse to re-draw over an existing split; the seed must be committed clean.
  if (existsSync(manifestFile)) {
    try {
      const prev = JSON.parse(readFileSync(manifestFile, 'utf8'));
      if (prev?.kind === 'split') throw new Error(`split refused: ${manifestFile} already holds a draw (seed ${prev.seed}); refusing to redraw silently`);
    } catch (e) { if (/already holds a draw/.test(e.message)) throw e; }
  }
  const committed = requireCommittedSeed(seedFile, cliSeed);
  const seed = committed.seed;
  const rng = seededRng(seed);

  const items = loadDevItems(home);
  const corpusSha256 = sha256(readFileSync(path.join(home, 'l0', 'dev-items.jsonl'), 'utf8'));
  // Review §3: verdict strata from a converge RECOMPUTED on the current trio
  // (muse-wonder-max, astra-max, opus-5.5-max) after Astra's pass 1 — never a stale file.
  const { latestVotes, summarise } = await import('../l2/converge.mjs');
  const { latest } = latestVotes(home, 1);
  // Review §3c: pass-1 coverage must be COMPLETE per annotator — a partial Astra pass
  // must not silently produce false strata.
  for (const a of ANNOTATORS) {
    const votes = latest.get(a);
    if (!votes || votes.size === 0) throw new Error(`split refused: no pass-1 votes for ${a} (run Astra pass 1 first)`);
    if (votes.size !== items.length) throw new Error(`split refused: incomplete pass-1 coverage for ${a} (${votes.size}/${items.length} items — finish Astra pass 1 first)`);
    const missing = items.some((it) => !votes.has(it.itemId));
    if (missing) throw new Error(`split refused: incomplete pass-1 coverage for ${a} (some items without a vote — finish Astra pass 1 first)`);
  }
  const { rows: convRows } = summarise(items, latest);
  const convergeSha256 = sha256(JSON.stringify(convRows));
  const verdictOf = new Map(convRows.map((r) => [r.itemId, r.verdictMaj?.value ?? 'no-majority']));
  const sigManifest = JSON.parse(readFileSync(path.join(classifDir(process.env), 'l0', 'manifests', 'signal-draw-manifest.json'), 'utf8'));
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
  const halves = splitGrouped([...byCity.values()], targets, rng);
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
  const manifest = { kind: 'split', seed: committed.seed, seedFile: path.relative(root, seedFile), committedAt: committed.committedAt, drawnAt: new Date().toISOString(), llmCalls: 0,
    trio: [...ANNOTATORS], corpusSha256, convergeSha256,
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
