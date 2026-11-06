// Split balance on a realistic synthetic fixture (reference set D shape).
// The fixture mirrors the real draw inputs without touching them: 504 items in
// ~180 cities (sizes 1-8) over the 9 real strata (pv 17/103; signal pass1
// 120/72, pass2 27/65/4, pass3 10/86). No paid call, temp homes/repos only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chiSquareHalves } from '../l4/metrics.mjs';
import { seededRng, splitGrouped } from '../l3/split.mjs';
import { CLASSIF_DIR, commitAll, initTempRepo, swapEnv, withTempHome, writeRepoFile } from './hermetic-helpers.mjs';
import console from 'node:console';
import process from 'node:process';

/** Real stratum totals of the reference set D draw (9 strata, 504 items). */
export const STRATA_TOTALS = new Map([
  ['pv|a_surveiller|pv', 17],
  ['pv|non_pertinent|pv', 103],
  ['signal|a_surveiller|pass1', 120],
  ['signal|non_pertinent|pass1', 72],
  ['signal|a_surveiller|pass2', 27],
  ['signal|non_pertinent|pass2', 65],
  ['signal|pertinent|pass2', 4],
  ['signal|a_surveiller|pass3', 10],
  ['signal|non_pertinent|pass3', 86],
]);

export const FIXTURE_SEEDS = ['split-balance-seed-1', 'split-balance-seed-2', 'split-balance-seed-3'];

/**
 * Balance bound. The rejected real draw scored chi2Total 496 at 502/2; fixed
 * greedy draws on this fixture score in the single digits, so 30 keeps a wide
 * margin over fixed-draw noise while staying an order of magnitude below the
 * bug level.
 */
export const CHI2_BOUND = 30;

/** Deterministic fixture: 180 cities, sizes 1-8, exact stratum totals above. */
export function buildFixtureCities() {
  const labels = [];
  for (const [s, n] of STRATA_TOTALS) for (let i = 0; i < n; i++) labels.push(s);
  const rs = seededRng('split-balance-fixture-labels-v1');
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(rs() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  const nCities = 180;
  const rw = seededRng('split-balance-fixture-sizes-v1');
  const weights = Array.from({ length: nCities }, () => 1 + rw() * rw() * 7);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.max(1, Math.min(8, Math.round((w * 504) / sumW))));
  let sum = sizes.reduce((a, b) => a + b, 0);
  for (let k = 0; sum < 504; k++) {
    if (sizes[k % nCities] < 8) { sizes[k % nCities]++; sum++; }
    if (k > 100000) throw new Error('fixture size adjustment did not converge');
  }
  for (let k = 0; sum > 504; k++) {
    if (sizes[k % nCities] > 1) { sizes[k % nCities]--; sum--; }
    if (k > 100000) throw new Error('fixture size adjustment did not converge');
  }
  const cities = [];
  let pos = 0;
  for (let c = 0; c < nCities; c++) {
    const items = [];
    for (let i = 0; i < sizes[c]; i++) items.push({ id: `fixture-city-${c}-item-${i}`, stratum: labels[pos++] });
    cities.push({ city: `ville-fixture-${c}`, items });
  }
  assert.equal(pos, 504);
  return cities;
}

export function targetsOf() {
  return new Map([...STRATA_TOTALS].map(([k, v]) => [k, v / 2]));
}

/** Per-stratum (tuning, blind) counts plus halves sizes and chi2Total. */
export function figureOf(cities, halves) {
  const inTuning = new Set(halves.tuning);
  const per = new Map([...STRATA_TOTALS.keys()].map((s) => [s, { a: 0, b: 0 }]));
  for (const c of cities) {
    for (const it of c.items) {
      const e = per.get(it.stratum);
      if (inTuning.has(it.id)) e.a++; else e.b++;
    }
  }
  let chi2Total = 0;
  for (const s of per.keys()) chi2Total += chiSquareHalves(per.get(s).a, per.get(s).b).chi2;
  return { tuning: halves.tuning.length, blind: halves.blind.length, per, chi2Total };
}

export function assertBalanced(cities, halves, seed) {
  const fig = figureOf(cities, halves);
  console.log(`[split-balance] seed=${seed} tuning=${fig.tuning} blind=${fig.blind} chi2Total=${fig.chi2Total.toFixed(2)}`);
  assert.ok(fig.tuning >= 244 && fig.tuning <= 260, `seed ${seed}: tuning size ${fig.tuning} outside 252±8`);
  assert.ok(fig.blind >= 244 && fig.blind <= 260, `seed ${seed}: blind size ${fig.blind} outside 252±8`);
  for (const [s, total] of STRATA_TOTALS) {
    const tol = Math.max(2, total * 0.1);
    const { a, b } = fig.per.get(s);
    assert.ok(Math.abs(a - total / 2) <= tol, `seed ${seed}: stratum ${s} tuning ${a} outside ${total / 2}±${tol}`);
    assert.ok(Math.abs(b - total / 2) <= tol, `seed ${seed}: stratum ${s} blind ${b} outside ${total / 2}±${tol}`);
  }
  const cityOf = new Map();
  for (const c of cities) for (const it of c.items) cityOf.set(it.id, c.city);
  const tuningCities = new Set(halves.tuning.map((id) => cityOf.get(id)));
  const overlap = halves.blind.filter((id) => tuningCities.has(cityOf.get(id)));
  assert.deepEqual(overlap, [], `seed ${seed}: ${overlap.length} cities land in both halves`);
  assert.ok(fig.chi2Total < CHI2_BOUND, `seed ${seed}: chi2Total ${fig.chi2Total.toFixed(2)} above bound ${CHI2_BOUND}`);
  return fig;
}

test('split balance: realistic 504-item fixture stays balanced for several seeds', () => {
  const cities = buildFixtureCities();
  assert.equal(cities.length, 180);
  assert.equal(cities.reduce((s, c) => s + c.items.length, 0), 504);
  const sizes = cities.map((c) => c.items.length);
  assert.ok(Math.min(...sizes) >= 1 && Math.max(...sizes) <= 8);
  const targets = targetsOf();
  const figs = FIXTURE_SEEDS.map((seed) => assertBalanced(cities, splitGrouped(cities, targets, seededRng(seed)), seed));
  void figs;
  const h1 = splitGrouped(cities, targets, seededRng(FIXTURE_SEEDS[0]));
  const h2 = splitGrouped(cities, targets, seededRng(FIXTURE_SEEDS[1]));
  assert.notDeepEqual(h1, h2, 'two seeds must draw different halves');
  const h1b = splitGrouped(cities, targets, seededRng(FIXTURE_SEEDS[0]));
  assert.deepEqual(h1, h1b, 'the same seed reproduces the draw');
});

// End-to-end: the real split.main draws balanced halves from the fixture in a
// temp repo (temp CLASSIF_HOME + CLASSIF_REPO in test mode, never the checkout).
test('split balance: real split.main draws balanced halves from the fixture', withTempHome(async (home) => {
  const { sha256 } = await import('../lib/render.mjs');
  const { ANNOTATORS } = await import('../l2/run.mjs');
  const { main: splitMain } = await import('../l3/split.mjs');
  const seed = 'split-balance-e2e-v1';
  const cities = buildFixtureCities();
  const items = [];
  const signalPass = [];
  for (const c of cities) {
    for (const it of c.items) {
      const [kind, , bpass] = it.stratum.split('|');
      items.push({ itemId: it.id, kind, anchor: { id: `n-${it.id}`, citySlug: c.city }, input: `avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9, dossier ${it.id}.` });
      if (kind === 'signal') signalPass.push({ itemId: it.id, pass: bpass });
    }
  }
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), body);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: items.length, sha256: sha256(body) }));
  const codeFor = (v) => (v === 'pertinent' ? 'P-DENSITE' : v === 'a_surveiller' ? 'S-PLANIFIE' : 'N-ADMIN');
  const verdictOf = new Map(cities.flatMap((c) => c.items.map((it) => [it.id, it.stratum.split('|')[1]])));
  for (const a of ANNOTATORS) {
    const d = path.join(home, 'l2', 'pass1', a);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 's001.json'), JSON.stringify({
      pass: 1, annotator: a, lotId: 's001', exitCode: 0, attempts: 1, guide: 'G0',
      annotations: items.map((i) => ({
        itemId: i.itemId, kind: i.kind, valid: true, code: codeFor(verdictOf.get(i.itemId)),
        verdict: verdictOf.get(i.itemId), ambiguous: false, cause: null,
        quote: 'avis de motion', reason: 'fixture', changed: false, quoteFound: true,
      })),
    }));
  }
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  const savedSeed = process.env.CLASSIF_SEED;
  delete process.env.CLASSIF_SEED;
  try {
    writeRepoFile(repo, 'tools/classif/l0/manifests/signal-draw-manifest.json', JSON.stringify({ items: signalPass }));
    writeRepoFile(repo, 'tools/classif/l3/manifests/split-seed.json', JSON.stringify({ seed, committedAt: new Date().toISOString() }));
    commitAll(repo);
    const realSplit = path.join(CLASSIF_DIR, 'l3', 'manifests', 'split.json');
    const realBefore = existsSync(realSplit) ? readFileSync(realSplit, 'utf8') : null;
    const manifest = await splitMain([]);
    assert.equal(manifest.kind, 'split');
    assert.equal(manifest.seed, seed);
    assert.deepEqual([...manifest.halves.tuning, ...manifest.halves.blind].sort(), items.map((i) => i.itemId).sort());
    assert.equal(manifest.cityOverlap, 0);
    console.log(`[split-balance] e2e seed=${seed} tuning=${manifest.counts.tuning} blind=${manifest.counts.blind} chi2Total=${manifest.chi2Total.toFixed(2)}`);
    assert.ok(manifest.counts.tuning >= 244 && manifest.counts.tuning <= 260, `e2e tuning size ${manifest.counts.tuning} outside 252±8`);
    assert.ok(manifest.counts.blind >= 244 && manifest.counts.blind <= 260, `e2e blind size ${manifest.counts.blind} outside 252±8`);
    for (const row of manifest.balance) {
      const total = STRATA_TOTALS.get(row.stratum);
      assert.ok(total !== undefined, `e2e unexpected stratum ${row.stratum}`);
      const tol = Math.max(2, total * 0.1);
      assert.ok(Math.abs(row.tuning - total / 2) <= tol, `e2e stratum ${row.stratum} tuning ${row.tuning} outside ${total / 2}±${tol}`);
      assert.ok(Math.abs(row.blind - total / 2) <= tol, `e2e stratum ${row.stratum} blind ${row.blind} outside ${total / 2}±${tol}`);
    }
    assert.ok(manifest.chi2Total < CHI2_BOUND, `e2e chi2Total ${manifest.chi2Total.toFixed(2)} above bound ${CHI2_BOUND}`);
    const realAfter = existsSync(realSplit) ? readFileSync(realSplit, 'utf8') : null;
    assert.equal(realAfter, realBefore, 'real checkout split.json unchanged by the temp draw');
  } finally {
    if (savedSeed === undefined) delete process.env.CLASSIF_SEED; else process.env.CLASSIF_SEED = savedSeed;
    restoreRepo();
    rmSync(repo, { recursive: true, force: true });
  }
}));
