// Minors tests (review round 3: D1-D4, §7b, §9, §12): cheap unit coverage for the
// test-mode gates, M.3 selection, series validation, cause evidence and the S113
// resume predicate. No paid call, temp repos/homes only, never the real checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../lib/render.mjs';
import { stableStringify } from '../lib/render.mjs';
import { testOnlyEnv } from '../lib/paths.mjs';
import { commitAll, initTempRepo, readFixture, splitShas, swapEnv, tmp, withTempHome, writeRepoFile } from './hermetic-helpers.mjs';
import process from 'node:process';

const TEST_HOOKS = ['CLASSIF_SPLIT_FILE', 'CLASSIF_REPO', 'CLASSIF_EVAL_DIR', 'CLASSIF_TEST_QUOTA_WAIT_MS', 'CLASSIF_ASTRA_AUTH_SRC', 'CLASSIF_VIBE_CONFIG_SRC'];

// D1: every test-only hook is unset-invisible, production-refused, test-honoured.
test('minors D1: test-only env hooks refuse production, work in test mode', () => {
  for (const name of TEST_HOOKS) {
    const rMode = swapEnv('CLASSIF_TEST_MODE', undefined);
    const rHook = swapEnv(name, undefined);
    try {
      assert.equal(testOnlyEnv(process.env, name), undefined, `${name} unset reads as undefined`);
    } finally { rHook(); rMode(); }
  }
  for (const name of TEST_HOOKS) {
    const rMode = swapEnv('CLASSIF_TEST_MODE', undefined);
    const rHook = swapEnv(name, '/tmp/hook');
    try {
      assert.throws(() => testOnlyEnv(process.env, name), /test-only/, `${name} set without test mode must refuse`);
    } finally { rHook(); rMode(); }
  }
  const rMode = swapEnv('CLASSIF_TEST_MODE', '1');
  try {
    for (const name of TEST_HOOKS) {
      const rHook = swapEnv(name, '/tmp/hook');
      try {
        assert.equal(testOnlyEnv(process.env, name), '/tmp/hook', `${name} set in test mode must be honoured`);
      } finally { rHook(); }
    }
  } finally { rMode(); }
});

// D1 wiring: the hooks throw at the production call site without test mode.
test('minors D1: gates fire at the production call sites', async () => {
  const { tuningHalf } = await import('../l2/amend.mjs');
  const { ensureAstraHome } = await import('../run-seat.mjs');
  const { vibeHome } = await import('../lib/vibe-home.mjs');
  const { testQuotaWaitMs } = await import('../l2/run.mjs');
  const { assertEvalRunAllowed } = await import('../guard/evalset.mjs');
  const rMode = swapEnv('CLASSIF_TEST_MODE', undefined);
  const rSplit = swapEnv('CLASSIF_SPLIT_FILE', '/tmp/split.json');
  const rAstra = swapEnv('CLASSIF_ASTRA_AUTH_SRC', '/tmp/auth.json');
  const rVibe = swapEnv('CLASSIF_VIBE_CONFIG_SRC', '/tmp/vibe.toml');
  const rQuota = swapEnv('CLASSIF_TEST_QUOTA_WAIT_MS', '5');
  const rEval = swapEnv('CLASSIF_EVAL_DIR', '/tmp/eval');
  try {
    assert.throws(() => tuningHalf(), /test-only/, 'CLASSIF_SPLIT_FILE without test mode refuses');
    assert.throws(() => ensureAstraHome('/tmp/nope'), /test-only/, 'CLASSIF_ASTRA_AUTH_SRC without test mode refuses');
    assert.throws(() => vibeHome('/tmp/nope', 'low'), /test-only/, 'CLASSIF_VIBE_CONFIG_SRC without test mode refuses');
    assert.throws(() => testQuotaWaitMs(), /test-only/, 'CLASSIF_TEST_QUOTA_WAIT_MS without test mode refuses');
    assert.throws(() => assertEvalRunAllowed({ promptFile: 'p', promptSha256: 's', model: 'm', effort: 'e' }), /test-only/, 'CLASSIF_EVAL_DIR without test mode refuses');
  } finally { rEval(); rQuota(); rVibe(); rAstra(); rSplit(); rMode(); }
});

// D1/D2: in test mode the overrides steer to a temp committed split, fake auth
// and fake vibe config — never the real files.
test('minors D1/D2: test-mode overrides steer to fixtures', withTempHome(async (home) => {
  const { tuningHalf } = await import('../l2/amend.mjs');
  const { ensureAstraHome, astraCodexHomeDir } = await import('../run-seat.mjs');
  const { vibeHome } = await import('../lib/vibe-home.mjs');
  const { testQuotaWaitMs } = await import('../l2/run.mjs');
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  try {
    writeRepoFile(repo, 'tools/classif/l3/manifests/split.json',
      JSON.stringify({ halves: { tuning: ['t1', 't2'], blind: ['b1'] } }));
    commitAll(repo);
    assert.deepEqual([...tuningHalf()].sort(), ['t1', 't2']);
    assert.equal(testQuotaWaitMs(), undefined);
    const rQuota = swapEnv('CLASSIF_TEST_QUOTA_WAIT_MS', '7');
    try {
      assert.equal(testQuotaWaitMs(), 7);
    } finally { rQuota(); }
    // Fake auth copied into the isolated seat home (mode 600), never the real one.
    const dir = ensureAstraHome({ home });
    assert.equal(dir, astraCodexHomeDir());
    assert.equal(readFileSync(path.join(dir, 'auth.json'), 'utf8'), '{"fake":"auth-for-hermetic-tests"}');
    // Fake vibe config expanded with the classification aliases.
    const vdir = vibeHome(home, 'low');
    assert.ok(readFileSync(path.join(vdir, 'config.toml'), 'utf8').includes('glm-5-3-classif'));
  } finally {
    restoreRepo();
    rmSync(repo, { recursive: true, force: true });
  }
}));

// §3c (cheap): requireCommittedSplit refuses absent/uncommitted/dirty, honours clean.
test('minors §3c: requireCommittedSplit enforces the committed split', withTempHome(async () => {
  const { requireCommittedSplit } = await import('../l3/split.mjs');
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  const rel = 'tools/classif/l3/manifests/split.json';
  try {
    assert.throws(() => requireCommittedSplit(), /absent/);
    writeRepoFile(repo, rel, JSON.stringify({ halves: { tuning: ['t1'], blind: ['b1'] } }));
    assert.throws(() => requireCommittedSplit(), /not committed/);
    commitAll(repo);
    assert.deepEqual(requireCommittedSplit().halves.tuning, ['t1']);
    writeRepoFile(repo, rel, JSON.stringify({ halves: { tuning: ['t1', 't2'], blind: ['b1'] } }));
    assert.throws(() => requireCommittedSplit(), /differs from the committed/);
  } finally {
    restoreRepo();
    rmSync(repo, { recursive: true, force: true });
  }
}));

// §9: loadSeriesManifest requires halves (§9); shapes stay enforced (§9b/§9c).
test('minors §9: series manifest requires halves and valid shapes', withTempHome(async () => {
  const { loadSeriesManifest, assertSeriesRoutes, assertSeriesHalves } = await import('../l4/series.mjs');
  const base = JSON.parse(readFixture('l4/manifests/series-98.json'));
  assert.ok(base.halves?.tuningSha256, 'the series-98 fixture carries its own halves (D2)');
  const repo = initTempRepo();
  const restoreMode = swapEnv('CLASSIF_TEST_MODE', '1');
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  const rel = 'tools/classif/l4/manifests/series-98.json';
  try {
    writeRepoFile(repo, rel, JSON.stringify(base));
    commitAll(repo);
    const loaded = loadSeriesManifest('98');
    assert.equal(loaded.kind, 'l4-series');
    // Missing halves refuse.
    const noHalves = { ...base };
    delete noHalves.halves;
    writeRepoFile(repo, rel, JSON.stringify(noHalves));
    commitAll(repo, 'no-halves');
    assert.throws(() => loadSeriesManifest('98'), /halves/, 'a manifest without halves must refuse');
    // Malformed halves refuse.
    const badHalves = { ...base, halves: { tuningSha256: 'zzz', blindSha256: base.halves.blindSha256 } };
    writeRepoFile(repo, rel, JSON.stringify(badHalves));
    commitAll(repo, 'bad-halves');
    assert.throws(() => loadSeriesManifest('98'), /halves/, 'malformed halves must refuse');
    // §9c: floors at 0, empty routes still refuse.
    const badFloors = { ...base, floors: {} };
    writeRepoFile(repo, rel, JSON.stringify(badFloors));
    commitAll(repo, 'bad-floors');
    assert.throws(() => loadSeriesManifest('98'), /floors/, 'floors at 0 must refuse');
    const badRoutes = { ...base, routes: [] };
    writeRepoFile(repo, rel, JSON.stringify(badRoutes));
    commitAll(repo, 'bad-routes');
    assert.throws(() => loadSeriesManifest('98'), /routes/, 'empty routes must refuse');
    // §9b: route and halves matching.
    assert.doesNotThrow(() => assertSeriesRoutes(base, [...base.routes], '98'));
    assert.throws(() => assertSeriesRoutes(base, [...base.routes, 'extra-route'], '98'), /differ/);
    const shas = splitShas(['t1'], ['b1']);
    const spec = { ...base, halves: { tuningSha256: shas.tuning, blindSha256: shas.blind } };
    assert.doesNotThrow(() => assertSeriesHalves(spec, '98', shas));
    assert.throws(() => assertSeriesHalves(spec, '98', { tuning: '0'.repeat(64), blind: shas.blind }), /halves sha differs/);
  } finally {
    restoreRepo();
    restoreMode();
    rmSync(repo, { recursive: true, force: true });
  }
}));

// D4: a failed route (verdict fail or ceiling breach) never outranks an eligible one.
test('minors D4: failing routes sort last and leave best', async () => {
  const { compareRoutes, routeFailed } = await import('../l4/metrics.mjs');
  const { selectBest } = await import('../l4/dev.mjs');
  const eligible = (over = {}) => ({ stats: { recallLB: 0.5, recall: 0.6, precisionLB: 0.4, precision: 0.5, indeterminate: {} },
    promptVersion: 'P1', costUsd: 1, failures: 0, verdict: 'pass', items: 10, failureCeiling: 0.1, route: 'e', ...over });
  assert.equal(routeFailed(eligible()), false);
  assert.equal(routeFailed({}), false, 'legacy objects without failure evidence stay eligible');
  assert.equal(routeFailed(eligible({ verdict: 'fail' })), true);
  assert.equal(routeFailed(eligible({ failures: 2 })), true, '2/10 failures breach the 0.1 ceiling');
  assert.equal(routeFailed(eligible({ failures: 1 })), false, '1/10 failures honour the ceiling');
  const bad = eligible({ route: 'bad', verdict: 'fail', stats: { recallLB: 0.99, recall: 0.99, precisionLB: 0.99, precision: 0.99, indeterminate: {} }, costUsd: 0 });
  const good = eligible({ route: 'good' });
  assert.ok(compareRoutes(bad, good) > 0, 'verdict-fail never outranks an eligible route, however strong');
  assert.ok(compareRoutes(good, bad) < 0);
  const breached = eligible({ route: 'breach', failures: 5 });
  assert.ok(compareRoutes(breached, good) > 0, 'ceiling breach never outranks an eligible route');
  const ranked = [bad, good, breached].sort(compareRoutes);
  const sel = selectBest(ranked);
  assert.deepEqual(sel.order, ['good', 'bad', 'breach']);
  assert.equal(sel.best, 'good');
  assert.deepEqual(sel.excluded.sort(), ['bad', 'breach']);
  assert.equal(selectBest([bad, breached].sort(compareRoutes)).best, null, 'no eligible route means no best');
});

// D3: the aggregates hash is order-independent (resume restores must hash equally).
test('minors D3: stable stringify canonicalises key order', async () => {
  const { sha256 } = await import('../lib/render.mjs');
  const a = { perRoute: { r2: { v: 1 }, r1: { v: 2 } }, s113: { x: [3, 2, 1] } };
  const b = { s113: { x: [3, 2, 1] }, perRoute: { r1: { v: 2 }, r2: { v: 1 } } };
  assert.notEqual(JSON.stringify(a), JSON.stringify(b), 'plain stringify is order-sensitive (the bug)');
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(sha256(stableStringify(a)), sha256(stableStringify(b)));
  assert.equal(stableStringify([3, 2, 1]), '[3,2,1]', 'array order is preserved');
  assert.equal(stableStringify({ b: 1, a: undefined, c: 2 }), stableStringify({ c: 2, b: 1 }), 'undefined object keys are omitted like JSON.stringify');
  assert.equal(stableStringify({ a: undefined }), '{}', 'an only-undefined object stringifies to {}');
  assert.equal(stableStringify([1, undefined, 3]), JSON.stringify([1, undefined, 3]), 'undefined array items become null like JSON.stringify');
});

// D3: the S113 plan and skip share one predicate (verified file + eval-run audit).
test('minors D3: isS113Done needs the verified file and the audit', withTempHome(async (_home) => {
  const { isS113Done } = await import('../l4/blind.mjs');
  const { ROUTES } = await import('../run-seat.mjs');
  const { model, effort } = ROUTES['glm-5.3-low'];
  const outDir = tmp('minors-s113-');
  const evalDir = tmp('minors-eval-');
  const k = '98';
  const promptSha = 'a'.repeat(64);
  const key = { outDir, k, promptSha, route: 'glm-5.3-low', evalDir };
  try {
    assert.equal(isS113Done(key), false, 'missing file is not done');
    writeFileSync(path.join(evalDir, 'access-log.jsonl'),
      `${JSON.stringify({ action: 'eval-run', purpose: 'l4-s113-s98', promptSha256: promptSha, model, effort })}\n`);
    assert.equal(isS113Done(key), false, 'audit without file is not done');
    writeFileSync(path.join(outDir, 's113-series-98-glm-5.3-low.json'),
      JSON.stringify({ series: '98', route: 'glm-5.3-low', promptSha256: 'b'.repeat(64), s113: {} }));
    assert.equal(isS113Done(key), false, 'stale prompt sha is not done');
    writeFileSync(path.join(outDir, 's113-series-98-glm-5.3-low.json'),
      JSON.stringify({ series: '98', route: 'glm-5.3-low', promptSha256: promptSha, s113: {} }));
    assert.equal(isS113Done(key), true, 'verified file + audit is done');
    rmSync(path.join(evalDir, 'access-log.jsonl'));
    assert.equal(isS113Done(key), false, 'verified file without audit is not done');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(evalDir, { recursive: true, force: true });
  }
}));

// §7b: definition-gap applies only without other evidence, and the map counts fallbacks.
test('minors §7b: classifyResidual derives the cause from evidence', async () => {
  const { classifyResidual, summariseCauses } = await import('../l2/ambiguity.mjs');
  const v = (o) => ({ code: 'S-A', ambiguous: false, cause: null, goldenPrecedent: [], ...o });
  const golden = new Map([[18, { code: 'P-X', verdict: 'pertinent' }]]);
  const ctx = { kind: 'signal', confusedPairs: new Set(), goldenCodes: golden };
  // Other causes carry evidence and never fall back.
  assert.equal(classifyResidual([v({ ambiguous: true, cause: 'missing-information' })], { ...ctx, scrapeStatus: 'ok' }).fallback, false);
  assert.equal(classifyResidual([v({ code: 'S-A', goldenPrecedent: [18] }), v({ code: 'S-B', goldenPrecedent: [18] })], ctx).fallback, false);
  assert.equal(classifyResidual([v({ code: 'S-A' }), v({ code: 'S-B' }), v({ code: 'S-A' })],
    { ...ctx, confusedPairs: new Set(['S-A × S-B']) }).fallback, false);
  // Positive gap evidence: every vote ambiguous, or a scope/conflict cause.
  const gapVotes = [v({ code: 'S-A', ambiguous: true }), v({ code: 'S-A', ambiguous: true })];
  const gap = classifyResidual(gapVotes, ctx);
  assert.equal(gap.cause, 'definition-gap');
  assert.equal(gap.fallback, false, 'unanimous ambiguity is positive gap evidence');
  const gap2 = classifyResidual([v({ code: 'S-A', cause: 'scope-unclear' }), v({ code: 'S-B', cause: 'scope-unclear' })], ctx);
  assert.equal(gap2.fallback, false, 'scope-unclear is positive gap evidence');
  // No evidence at all: two bare disagreeing codes fall back to definition-gap.
  const bare = classifyResidual([v({ code: 'S-A' }), v({ code: 'S-B' })], ctx);
  assert.equal(bare.cause, 'definition-gap');
  assert.equal(bare.fallback, true, 'a bare disagreement with no deciding rule is a fallback');
  const { counts, fallbackToDefinitionGap } = summariseCauses([
    { cause: 'definition-gap', fallback: true }, { cause: 'definition-gap', fallback: false },
    { cause: 'missing-information', fallback: false },
  ]);
  assert.equal(counts['definition-gap'], 2);
  assert.equal(counts['missing-information'], 1);
  assert.equal(fallbackToDefinitionGap, 1, 'the map reports how many fell back');
});

// §7b consumption: fallback residuals are reported and block the stop below the cap.
test('minors §7b: residualsClassified reports fallbacks that block the stop', withTempHome(async (home) => {
  const { residualsClassified } = await import('../l2/converge.mjs');
  const { stopDecision } = await import('../l2/agreement.mjs');
  mkdirSync(path.join(home, 'l2'), { recursive: true });
  writeFileSync(path.join(home, 'l2', 'ambiguity-pass2.json'), JSON.stringify({ residuals: [
    { itemId: 'r1', cause: 'definition-gap', fallback: true },
    { itemId: 'r2', cause: 'missing-information', fallback: false },
  ] }));
  const r = residualsClassified(home, 2, ['r1', 'r2']);
  assert.equal(r.classified, true, 'both residuals carry a cause class');
  assert.equal(r.fallbackToDefinitionGap, 1, 'one fallback residual reported');
  assert.deepEqual(r.fallbackIds, ['r1']);
  assert.equal(stopDecision({ changedShare: 0.01, pass: 3, residualsClassified: r.classified, hasAmend: true, fallbackToDefinitionGap: r.fallbackToDefinitionGap }).stop,
    false, 'fallback residuals block the stop below the cap');
  const capped = stopDecision({ changedShare: 0.01, pass: 5, residualsClassified: r.classified, hasAmend: true, fallbackToDefinitionGap: r.fallbackToDefinitionGap });
  assert.equal(capped.stop, true, 'the 4-pass cap stops and reports fallbacks as such');
  assert.match(capped.why, /fallback/);
}));

// §11a: the FINAL guard fails closed on a missing, corrupt, sha-less or drifted manifest.
test('minors §11a: assertFinalGuide fails closed without a valid freeze', async () => {
  const { assertFinalGuide } = await import('../lib/freeze.mjs');
  const home = tmp('minors-freeze-');
  try {
    mkdirSync(path.join(home, 'l1', 'pack'), { recursive: true });
    writeFileSync(path.join(home, 'l1', 'pack', 'guide-FINAL.md'), 'final guide text');
    const manifest = path.join(home, 'freeze.json');
    assert.throws(() => assertFinalGuide(home, { manifestFile: manifest }), /absent/, 'missing manifest refuses');
    writeFileSync(manifest, 'truncated{');
    assert.throws(() => assertFinalGuide(home, { manifestFile: manifest }), /unparsable/, 'corrupt manifest refuses');
    writeFileSync(manifest, JSON.stringify({ kind: 'guide-freeze' }));
    assert.throws(() => assertFinalGuide(home, { manifestFile: manifest }), /no guideSha256/, 'sha-less manifest refuses');
    writeFileSync(manifest, JSON.stringify({ guideSha256: '0'.repeat(64) }));
    assert.throws(() => assertFinalGuide(home, { manifestFile: manifest }), /differs/, 'drifted guide refuses');
    writeFileSync(manifest, JSON.stringify({ guideSha256: sha256('final guide text') }));
    assert.ok(assertFinalGuide(home, { manifestFile: manifest }).guideSha256, 'matching freeze passes');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
