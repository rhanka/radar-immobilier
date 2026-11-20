// L4 blind recall non-regression (owner rule 06/11): hermetic, fake data only
// (l4-blind-fixture.mjs). The baseline is a fake private series-<b>-aggregates.json in the
// temp CLASSIF_HOME; claude answers non_pertinent on the ids in FAKE_CLAUDE_NP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTES } from '../run-seat.mjs';
import { blindRouteVerdict, loadBlindRecallBaseline } from '../l4/blind.mjs';
import { audit } from '../lib/blind.mjs';
import { withTempHome } from './hermetic-helpers.mjs';
import { SCORE_KEYS, blindIds, blindPass, readAggregates, setupBlind } from './l4-blind-fixture.mjs';
import process from 'node:process';

const K = '5';
const B = 4;
const ROUTES3 = ['opus-5.5-low', 'mistral-large-4-medium', 'glm-5.3-low'];
const N = 40;
const IDS = blindIds(N);
const NONREG = { recallNonRegression: { baselineSeries: B, metric: 'recall', tolerance: 0.02 } };
const SPEC = { floors: { recall: 0.01, precision: 0.01 }, failureCeiling: 0.1, supports: { recall: 10, precision: 10 }, ...NONREG };

function writeBaseline(home, perRoute) {
  mkdirSync(path.join(home, 'blind'), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, 'blind', `series-${B}-aggregates.json`),
    JSON.stringify({ series: String(B), promptSha256: 'f'.repeat(64), aggregatesSha256: 'e'.repeat(64), perRoute, s113: {} }), { mode: 0o600 });
}
const okStats = (recall) => ({ recall, recallLB: recall - 0.1, precision: 1, precisionLB: 0.9, indeterminate: { recall: false, precision: false } });

test('nonreg blind verdict: below baseline fails, at baseline passes, unknown baseline never passes', () => {
  const base = { baselineSeries: B, tolerance: 0.02, recall: { a: 0.9, b: 0.9, c: 'unknown' } };
  const spec = { floors: { recall: 0.01, precision: 0.01 }, failureCeiling: 0.1 };
  assert.deepEqual(blindRouteVerdict({ stats: okStats(0.85), failures: 0, items: N }, spec, base, 'a'), { verdict: 'fail', regressed: true, baselineRecall: 0.9 });
  assert.deepEqual(blindRouteVerdict({ stats: okStats(0.885), failures: 0, items: N }, spec, base, 'b'), { verdict: 'pass', regressed: false, baselineRecall: 0.9 }, 'within tolerance');
  assert.deepEqual(blindRouteVerdict({ stats: okStats(1), failures: 0, items: N }, spec, base, 'c'), { verdict: 'indeterminate', regressed: false, baselineRecall: 'unknown' });
  assert.equal(blindRouteVerdict({ stats: okStats(1), failures: 0, items: N }, spec, base, 'not-listed').verdict, 'indeterminate');
  assert.equal(blindRouteVerdict({ stats: okStats(1), failures: 30, items: N }, spec, base, 'c').verdict, 'fail', 'a fail earned on its own failures stays fail');
  assert.deepEqual(blindRouteVerdict({ stats: okStats(0.5), failures: 0, items: N }, spec, null, 'a'), { verdict: 'pass' }, 'no baseline: unchanged');
});

test('nonreg blind baseline: missing file, missing route, infra-failed route and pending infra re-run are unknown', withTempHome(async (home) => {
  const outDir = path.join(home, 'blind');
  const spec = { failureCeiling: 0.1, ...NONREG };
  assert.equal(loadBlindRecallBaseline({ seriesSpec: { failureCeiling: 0.1 }, outDir, home, routes: ROUTES3, items: N }), null, 'field absent: null');
  const none = loadBlindRecallBaseline({ seriesSpec: spec, outDir, home, routes: ROUTES3, items: N });
  assert.deepEqual(none.recall, { 'opus-5.5-low': 'unknown', 'mistral-large-4-medium': 'unknown', 'glm-5.3-low': 'unknown' });
  writeBaseline(home, {
    'opus-5.5-low': { ...okStats(0.9), failures: 0 },
    'glm-5.3-low': { ...okStats(1), failures: N },
  });
  const b = loadBlindRecallBaseline({ seriesSpec: spec, outDir, home, routes: ROUTES3, items: N });
  assert.deepEqual(b, { baselineSeries: B, tolerance: 0.02, recall: { 'opus-5.5-low': 0.9, 'mistral-large-4-medium': 'unknown', 'glm-5.3-low': 'unknown' } });
  // Baseline route recovered but its audited infra re-run is not completed yet: unknown.
  writeBaseline(home, { 'glm-5.3-low': { ...okStats(0.95), failures: 0 } });
  const { model, effort } = ROUTES['glm-5.3-low'];
  audit({ action: 'blind-run', purpose: `l4-blind-s${B}`, promptSha256: 'f'.repeat(64), model, effort, items: N, failures: N }, { home, env: process.env });
  audit({ action: 'blind-rerun-infra', purpose: `l4-blind-s${B}`, promptSha256: 'f'.repeat(64), model, effort, route: 'glm-5.3-low' }, { home, env: process.env });
  assert.equal(loadBlindRecallBaseline({ seriesSpec: spec, outDir, home, routes: ['glm-5.3-low'], items: N }).recall['glm-5.3-low'], 'unknown');
  audit({ action: 'blind-run', purpose: `l4-blind-s${B}`, promptSha256: 'f'.repeat(64), model, effort, items: N, failures: 0, infraRerun: true }, { home, env: process.env });
  assert.equal(loadBlindRecallBaseline({ seriesSpec: spec, outDir, home, routes: ['glm-5.3-low'], items: N }).recall['glm-5.3-low'], 0.95, 'completed re-run: known');
}));

test('nonreg blind executor: regressed route fails, infra-failed baseline is indeterminate, private regressed flags, repo manifest without scores', withTempHome(async (home) => {
  const s = await setupBlind(home, { k: K, routes: ROUTES3, ids: IDS, floors: SPEC.floors, supports: SPEC.supports, seriesExtra: NONREG });
  try {
    writeBaseline(home, {
      'opus-5.5-low': { ...okStats(0.9), failures: 0 },
      'mistral-large-4-medium': { ...okStats(1), failures: 0 },
      'glm-5.3-low': { ...okStats(1), failures: N },
    });
    const fake = { FAKE_CLAUDE_NP: IDS.slice(0, 20).join(' ') };
    const first = await blindPass(home, { k: K, routes: ROUTES3, fake });
    assert.equal(first.error, null, first.error?.stack);
    const agg = readAggregates(home, K);
    const pr = agg.perRoute;
    assert.equal(pr['opus-5.5-low'].recall, 0.5);
    assert.deepEqual(['opus-5.5-low', 'mistral-large-4-medium', 'glm-5.3-low'].map((r) => [pr[r].verdict, pr[r].regressed, pr[r].baselineRecall]),
      [['fail', true, 0.9], ['pass', false, 1], ['indeterminate', false, 'unknown']]);
    // Repo manifest: recallNonRegression {baselineSeries, tolerance} only, no score, no regressed flag.
    const repoManifest = JSON.parse(readFileSync(path.join(s.repo, 'tools', 'classif', 'l4', 'manifests', `series-${K}-blind.json`), 'utf8'));
    assert.deepEqual(repoManifest.recallNonRegression, { baselineSeries: B, tolerance: 0.02 });
    const blob = JSON.stringify(repoManifest);
    for (const bad of SCORE_KEYS) assert.ok(!blob.includes(bad), `repo manifest must not contain ${bad}`);
    assert.deepEqual(first.manifest, repoManifest, 'stdout manifest = repo manifest');
    // Baseline glm recovered (re-run completed): a resumed pass re-applies the gate, no seat call.
    writeBaseline(home, {
      'opus-5.5-low': { ...okStats(0.9), failures: 0 },
      'mistral-large-4-medium': { ...okStats(1), failures: 0 },
      'glm-5.3-low': { ...okStats(0.95), failures: 0 },
    });
    const again = await blindPass(home, { k: K, routes: ROUTES3, fake });
    assert.equal(again.error, null, again.error?.stack);
    assert.equal(again.calls.length, 0);
    const pr2 = readAggregates(home, K).perRoute;
    assert.deepEqual([pr2['glm-5.3-low'].verdict, pr2['glm-5.3-low'].regressed, pr2['glm-5.3-low'].baselineRecall], ['pass', false, 0.95]);
    assert.equal(pr2['opus-5.5-low'].verdict, 'fail');
    assert.notEqual(again.manifest.aggregatesSha256, first.manifest.aggregatesSha256, 'aggregates sha follows the re-applied gate');
  } finally { s.cleanup(); }
}));

test('nonreg blind executor: a series without recallNonRegression keeps its aggregates shape', withTempHome(async (home) => {
  const s = await setupBlind(home, { k: K, routes: ROUTES3, ids: IDS, floors: SPEC.floors, supports: SPEC.supports });
  try {
    const r = await blindPass(home, { k: K, routes: ROUTES3 });
    assert.equal(r.error, null, r.error?.stack);
    for (const e of Object.values(readAggregates(home, K).perRoute)) {
      assert.ok(!('regressed' in e) && !('baselineRecall' in e));
      assert.equal(e.verdict, 'pass');
    }
    assert.ok(!('recallNonRegression' in r.manifest));
  } finally { s.cleanup(); }
}));

