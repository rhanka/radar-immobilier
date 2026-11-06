// L4 recall non-regression (owner rule 06/11: « a lower recall is a regression »). Hermetic:
// fake data only, temp repo via CLASSIF_REPO in test mode, in-process fake seats (no paid call).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HARD_CONSTRAINT, TUNING_KEYS, buildObjective, buildOptimiserPrompt, buildReconciliationPrompt, main } from '../l4/optimise.mjs';
import { bestRecallBaseline, buildRecallComparison, compareRoutes, recallRegressed, seriesVerdict, shownMisses } from '../l4/metrics.mjs';
import { selectBest } from '../l4/dev.mjs';
import { assertRecallNonRegressionShape, loadSeriesManifest, loadTuningRecallBaseline } from '../l4/series.mjs';
import { commitAll, readFixture, swapEnv, withTempHome, writeRepoFile, initTempRepo } from './hermetic-helpers.mjs';
import { K, MATERIALS, OVERRIDE, fakeSeat, manifestFile, setup } from './l4-optimise-fixture.mjs';

const SPEC = { recallFloor: 0.8, precisionFloor: 0.5, failureCeiling: 0.05 };
const stats = (recall, precision) => ({ recall, recallLB: recall - 0.03, precision, precisionLB: precision - 0.05,
  indeterminate: { recall: false, precision: false } });
const NONREG = { baselineSeries: 0, metric: 'recall', tolerance: 0 };

test('nonreg verdict: a route with recall below the baseline fails even with a higher precision', () => {
  const s = stats(0.979, 0.95);
  assert.equal(seriesVerdict({ stats: s, failures: 0, items: 252 }, SPEC), 'pass', 'without a baseline the old verdict holds');
  assert.equal(seriesVerdict({ stats: s, failures: 0, items: 252 }, { ...SPEC, baselineRecall: 1, recallTolerance: 0 }), 'fail');
  // Whatever the supports: an indeterminate precision does not rescue a recall regression.
  const ind = { ...s, indeterminate: { recall: false, precision: true } };
  assert.equal(seriesVerdict({ stats: ind, failures: 0, items: 252 }, { ...SPEC, baselineRecall: 1 }), 'fail');
  // The tolerance is pre-registered; 0 means any drop fails.
  assert.equal(seriesVerdict({ stats: s, failures: 0, items: 252 }, { ...SPEC, baselineRecall: 0.99, recallTolerance: 0.02 }), 'pass');
  assert.equal(recallRegressed(94 / 95, 95 / 95, 0), true);
  assert.equal(recallRegressed(null, 1, 0), false);
});

test('nonreg verdict: equal recall with a higher precision passes; a route without baseline is unchanged', () => {
  assert.equal(seriesVerdict({ stats: stats(1, 0.85), failures: 0, items: 252 }, { ...SPEC, baselineRecall: 1, recallTolerance: 0 }), 'pass');
  assert.equal(seriesVerdict({ stats: stats(0.95, 0.85), failures: 0, items: 252 }, { ...SPEC, baselineRecall: null }), 'pass');
});

test('nonreg selection: lexicographic recall first, a regressed route never outranks an eligible one', () => {
  const mk = (route, recall, precision, verdict) => ({ route, stats: stats(recall, precision), verdict, failures: 0, items: 252, failureCeiling: 0.05, promptVersion: 'P3', costUsd: 0 });
  const regressed = mk('high-precision', 0.979, 0.95, seriesVerdict({ stats: stats(0.979, 0.95), failures: 0, items: 252 }, { ...SPEC, baselineRecall: 1 }));
  const kept = mk('full-recall', 1, 0.7, seriesVerdict({ stats: stats(1, 0.7), failures: 0, items: 252 }, { ...SPEC, baselineRecall: 1 }));
  const sel = selectBest([regressed, kept].sort(compareRoutes));
  assert.equal(sel.best, 'full-recall');
  assert.deepEqual(sel.excluded, ['high-precision']);
});

const OUTPUTS = {
  rA: [
    { itemId: 'it-1', ref: 'P-X', refVerdict: 'pertinent', pred: { code: 'N-Z', verdict: 'non_pertinent' }, failed: false },
    { itemId: 'it-2', ref: 'S-Y', refVerdict: 'a_surveiller', pred: { code: 'P-X', verdict: 'pertinent' }, failed: false },
    { itemId: 'it-3', ref: 'S-Y', refVerdict: 'a_surveiller', pred: null, failed: true },
    { itemId: 'it-4', ref: 'N-Z', refVerdict: 'non_pertinent', pred: { code: 'P-X', verdict: 'pertinent' }, failed: false },
    { itemId: 'it-5', ref: 'S-Y', refVerdict: 'a_surveiller', pred: { code: 'N-Z', verdict: 'non_pertinent' }, failed: false, unresolved: true },
  ],
  rB: [{ itemId: 'it-1', ref: 'P-X', refVerdict: 'pertinent', pred: { code: 'S-Y', verdict: 'a_surveiller' }, failed: false }],
};

test('nonreg misses: only a P/S reference predicted non_pertinent; P<->S, failures and unresolved rows are not misses', () => {
  assert.deepEqual(shownMisses(OUTPUTS.rA).map((r) => r.itemId), ['it-1']);
  assert.deepEqual(shownMisses(OUTPUTS.rB), []);
});

test('nonreg optimiser prompt: hard constraint, every miss with its expected code, baseline prompt; blind keys still refused', () => {
  assert.ok(TUNING_KEYS.includes('baselinePrompt'));
  const baselinePrompt = { series: 0, version: 'P0', best: 1, recall: { rA: 1, rB: 1 }, text: 'BASELINE PROMPT BODY' };
  const materials = { ...MATERIALS, tuningOutputs: OUTPUTS, baselinePrompt };
  const p = buildOptimiserPrompt(materials);
  assert.ok(p.startsWith('You improve'));
  assert.ok(p.includes(HARD_CONSTRAINT));
  assert.match(HARD_CONSTRAINT, /zero tuning-half item whose expected verdict is pertinent or a_surveiller may be predicted non_pertinent/);
  assert.match(HARD_CONSTRAINT, /greater than or equal to the baseline/);
  assert.match(HARD_CONSTRAINT, /Precision is improved ONLY under that constraint/);
  assert.match(p, /## rA: 1 miss\(es\)\n- it-1: expected P-X \(pertinent\) → predicted N-Z \(non_pertinent\)/);
  assert.match(p, /## rB: 0 miss\(es\)\n- none/);
  assert.ok(!/it-5: expected/.test(p), 'an unresolved row is not listed as a miss');
  assert.match(p, /Baseline prompt P0 \(series 0, the best tuning recall so far\)\. You MAY restart from it/);
  assert.ok(p.includes('BASELINE PROMPT BODY'));
  assert.match(p, /best tuning shown recall of any previous series = 1\.000/);
  // Firewall unchanged: any blind or unknown key throws, baselinePrompt included.
  for (const bad of ['blindRows', 'blindAggregates', 'baselineBlind', 'sealed']) {
    assert.throws(() => buildOptimiserPrompt({ ...materials, [bad]: {} }), /optimiser firewall/, bad);
  }
  // The reconciliation prompt states the same objective (default: the constraint alone).
  const rec = buildReconciliationPrompt(['a', 'b'], ['x', 'y'], buildObjective(materials));
  assert.ok(rec.startsWith('You fuse'));
  assert.ok(rec.includes(HARD_CONSTRAINT));
  assert.match(rec, /- it-1: expected P-X/);
  assert.ok(buildReconciliationPrompt(['a', 'b']).includes(HARD_CONSTRAINT));
});

test('nonreg optimise main: the best-recall series prompt is the baseline, misses counted in the manifest', withTempHome(async (home) => {
  const repo = setup(home);
  // Series 0 best recall 1 (a route failing every item never sets the baseline); series K lower.
  writeRepoFile(repo, 'tools/classif/l4/manifests/series-0-dev.json', JSON.stringify({ kind: 'l4-dev', aggregates: {
    r1: { recall: 1, verdict: 'pass' }, rFail: { recall: 1, verdict: 'fail' } } }));
  writeRepoFile(repo, 'tools/classif/l4/prompts/P0.md', 'P ZERO BASELINE TEXT\n');
  const miss = { itemId: 'it-1', ref: 'P-X', refVerdict: 'pertinent', pred: { code: 'N-Z', verdict: 'non_pertinent' }, failed: false };
  writeRepoFile(home, `l4/series-${K}/dev-r1.jsonl`, `${JSON.stringify(miss)}\n`);
  const f = fakeSeat();
  const m = await main(['--series', K, ...OVERRIDE], { seat: f.seat });
  const opt = f.byKind('opt')[0].prompt;
  assert.ok(opt.includes(HARD_CONSTRAINT));
  assert.ok(opt.includes('P ZERO BASELINE TEXT'));
  assert.match(opt, /## r1: 1 miss\(es\)\n- it-1: expected P-X \(pertinent\)/);
  assert.ok(f.byKind('rec')[0].prompt.includes(HARD_CONSTRAINT));
  const disk = JSON.parse(readFileSync(manifestFile(repo), 'utf8'));
  for (const man of [m, disk]) {
    assert.equal(man.objective.baselineSeries, 0);
    assert.equal(man.objective.baselineVersion, 'P0');
    assert.equal(man.objective.baselineRecall, 1);
    assert.deepEqual(man.objective.tuningMisses, { r1: 1 });
  }
  assert.ok(!JSON.stringify(disk).includes('it-1'), 'the repo manifest carries counts only');
}));

test('nonreg baseline: series 0 is the best-recall series of the recorded dev manifests (P1 is not progress)', () => {
  const ms = [0, 1].map((j) => ({ series: j, aggregates: JSON.parse(readFixture(`l4/manifests/series-${j}-dev.json`)).aggregates }));
  const b = bestRecallBaseline(ms);
  assert.equal(b.series, 0);
  assert.equal(b.best, 1);
  assert.equal(bestRecallBaseline([{ series: 0, aggregates: { r: { recall: 1, verdict: 'fail' } } }]), null);
});

test('nonreg comparison: recall delta and miss counts per route, counts only', () => {
  const cmp = buildRecallComparison(OUTPUTS, { rA: { recall: 0.75 }, rB: { recall: 1 }, rNew: { recall: 1 } },
    { baselineSeries: 0, tolerance: 0, recall: { rA: 1, rB: 1 } });
  assert.equal(cmp.rA.delta, -0.25);
  assert.equal(cmp.rA.misses, 1);
  assert.equal(cmp.rA.regressed, true);
  assert.equal(cmp.rB.delta, 0);
  assert.equal(cmp.rB.regressed, false);
  assert.ok(!JSON.stringify(cmp).includes('it-'), 'no item id in the comparison block');
});

test('nonreg manifest: the field is validated; old manifests without it load unchanged', withTempHome(async () => {
  const base = JSON.parse(readFixture('l4/manifests/series-98.json'));
  for (const j of [0, 1, 2]) assert.ok(!('recallNonRegression' in JSON.parse(readFixture(`l4/manifests/series-${j}.json`))), `series-${j} stays as registered`);
  const repo = initTempRepo();
  const restore = [swapEnv('CLASSIF_TEST_MODE', '1'), swapEnv('CLASSIF_REPO', repo)];
  const rel = 'tools/classif/l4/manifests/series-98.json';
  const put = (m, msg) => { writeRepoFile(repo, rel, JSON.stringify(m)); commitAll(repo, msg); };
  try {
    put(base, 'old');
    assert.deepEqual(loadSeriesManifest('98'), base, 'a manifest without the field is returned as committed');
    assert.equal(loadTuningRecallBaseline(base, '98'), null);
    put({ ...base, recallNonRegression: NONREG }, 'nonreg');
    assert.deepEqual(loadSeriesManifest('98').recallNonRegression, NONREG);
    for (const [bad, why] of [[{ ...NONREG, metric: 'precision' }, /metric/], [{ ...NONREG, baselineSeries: 98 }, /earlier series/],
      [{ ...NONREG, baselineSeries: -1 }, /baselineSeries/], [{ ...NONREG, tolerance: -0.1 }, /tolerance/], [[], /object/]]) {
      put({ ...base, recallNonRegression: bad }, `bad-${String(why)}`);
      assert.throws(() => loadSeriesManifest('98'), why);
    }
    assert.throws(() => assertRecallNonRegressionShape({ ...NONREG, tolerance: 1 }, '3'), /tolerance/);
    // The tuning baseline is the committed series-0 dev manifest (recall point estimates only).
    const spec = { ...base, recallNonRegression: NONREG };
    assert.throws(() => loadTuningRecallBaseline(spec, '98'), /absent/);
    const dev0 = path.join('tools', 'classif', 'l4', 'manifests', 'series-0-dev.json');
    writeRepoFile(repo, dev0, JSON.stringify({ kind: 'l4-dev', aggregates: { r1: { recall: 1 }, r2: { recall: 0.95 } } }));
    assert.throws(() => loadTuningRecallBaseline(spec, '98'), /not committed/);
    commitAll(repo, 'dev0');
    assert.deepEqual(loadTuningRecallBaseline(spec, '98'), { baselineSeries: 0, tolerance: 0, half: 'tuning', recall: { r1: 1, r2: 0.95 } });
  } finally {
    for (const r of restore) r();
  }
}));

// Real devMain (series 98, fake `vibe` on PATH): a manifest declaring recallNonRegression
// fails a route below the series-0 tuning recall and reports the recall-first comparison.
test('nonreg devMain: a regressed route fails and the dev manifest carries delta and miss counts only', withTempHome(async (home) => {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const { loadCodes } = await import('../l2/run.mjs');
  const { mkdirSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmp, writeSeriesRepo } = await import('./hermetic-helpers.mjs');
  const items = Array.from({ length: 4 }, (_, i) => ({ itemId: `nr98-i${i + 1}`, kind: 'signal', anchor: { id: `n${i + 1}`, citySlug: 'ville-test' },
    input: `avis de motion fictif ${i + 1} afin de permettre six logements dans une zone fictive.` }));
  const put = (rel, body) => { mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); writeFileSync(path.join(home, rel), body); };
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  put('l0/dev-items.jsonl', body);
  put('l0/dev-items.expect.json', JSON.stringify({ count: items.length, sha256: sha256(body) }));
  put('l3b/reference-d.jsonl', `${items.map((i) => JSON.stringify({ itemId: i.itemId, kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved', half: 'tuning' })).join('\n')}\n`);
  put('guard/salt', 'nr-salt\n');
  put('guard/fingerprints.json', JSON.stringify(buildFingerprints('nr-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif nr98'] })));
  const [nCode, nVerdict] = [...loadCodes()].find(([, v]) => v === 'non_pertinent');
  const inner = JSON.stringify({ verdict: nVerdict, code: nCode });
  const good = JSON.stringify([{ role: 'assistant', type: 'message', content: [{ type: 'text', text: inner }] }]);
  const bin = tmp('nr-bin-');
  writeFileSync(path.join(bin, 'vibe'), `#!/bin/sh\nprintf '%s' '${good}'\nexit 0\n`, { mode: 0o755 });
  chmodSync(path.join(bin, 'vibe'), 0o755);
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  try {
    writeSeriesRepo({ repo, k: '98', routes: ['glm-5.3-low'], tuningIds: items.map((i) => i.itemId), blindIds: ['nr-blind-1'],
      promptText: readFixture('l4/prompts/P98.md'), supports: { recall: 30, precision: 30 } });
    const rel = 'tools/classif/l4/manifests/series-98.json';
    const spec = JSON.parse(readFileSync(path.join(repo, rel), 'utf8'));
    writeRepoFile(repo, rel, JSON.stringify({ ...spec, recallNonRegression: NONREG }));
    writeRepoFile(repo, 'tools/classif/l4/manifests/series-0-dev.json', JSON.stringify({ kind: 'l4-dev', aggregates: { 'glm-5.3-low': { recall: 1 } } }));
    commitAll(repo, 'nonreg');
    const { main: devMain, EVAL_ROUTES } = await import('../l4/dev.mjs');
    const skip = EVAL_ROUTES.filter((r) => r !== 'glm-5.3-low');
    const rep = await devMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '1']);
    const agg = rep.aggregates['glm-5.3-low'];
    assert.equal(agg.recall, 0);
    assert.equal(agg.verdict, 'fail', 'below the baseline recall: fail, even with unmet supports');
    const cmp = rep.recallNonRegression;
    assert.equal(cmp.baselineSeries, 0);
    assert.equal(cmp.half, 'tuning');
    assert.deepEqual(cmp.routes['glm-5.3-low'], { baselineSeries: 0, baselineRecall: 1, recall: 0, delta: -1, tolerance: 0, misses: 4, regressed: true });
    assert.equal(rep.selection.best, null);
    const disk = readFileSync(path.join(repo, 'tools', 'classif', 'l4', 'manifests', 'series-98-dev.json'), 'utf8');
    assert.ok(!disk.includes('nr98-i'), 'counts only in the repo manifest');
  } finally {
    process.env.PATH = prevPath;
    rmSync(bin, { recursive: true, force: true });
    restoreRepo();
    rmSync(repo, { recursive: true, force: true });
  }
}));
