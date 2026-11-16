// Multi-pass series (owner 15/11, series 15): union of 2 passes as the pre-registered decision,
// pass 1, pass 2 and the 2-of-3 majority as information only. Hermetic: synthetic rows, PATH fake
// seats (l4-blind-fixture.mjs), temp CLASSIF_HOME and repo. No real model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { combinePasses, passPlan, planRules, ruleLabel } from '../l4/passes.mjs';
import { commitAll, swapEnv, withTempHome, writeRepoFile } from './hermetic-helpers.mjs';
import { SCORE_KEYS, blindIds, blindPass, readAggregates, setupBlind } from './l4-blind-fixture.mjs';

const P = { verdict: 'pertinent', code: 'P-DENSITE' };
const S = { verdict: 'a_surveiller', code: 'S-X' };
const N = { verdict: 'non_pertinent', code: 'N-ADMIN' };
const row = (pred, extra = {}) => ({ itemId: 'i', refVerdict: 'pertinent', failed: false, why: null, pred, ...extra });
const fail = () => ({ itemId: 'i', refVerdict: 'pertinent', failed: true, why: 'exit-1', pred: null });
const PLAN = { count: 3, decision: { rule: 'union', of: 2 }, info: [{ rule: 'single', of: 1, pass: 1 }, { rule: 'single', of: 1, pass: 2 }, { rule: 'majority', of: 3 }] };
const UNION2 = PLAN.decision;
const MAJ3 = PLAN.info[2];

test('union of 2: shown when pass 1 OR pass 2 shows it; pass 3 never read', () => {
  assert.deepEqual(combinePasses([row(N), row(S), row(N)], UNION2).pred, S);
  assert.deepEqual(combinePasses([row(P), row(N), row(N)], UNION2).pred, P);
  assert.deepEqual(combinePasses([row(N), row(N), row(P)], UNION2).pred, N, 'pass 3 is outside the decision');
  assert.deepEqual(combinePasses([row(N), row(N), row(P)], UNION2).passVerdicts, ['non_pertinent', 'non_pertinent']);
});

test('majority of 3: shown when at least 2 of 3 passes show it', () => {
  assert.deepEqual(combinePasses([row(N), row(P), row(S)], MAJ3).pred, P);
  assert.deepEqual(combinePasses([row(P), row(N), row(N)], MAJ3).pred, N);
  assert.deepEqual(combinePasses([row(N), row(N), row(N)], MAJ3).pred, N);
  assert.deepEqual(combinePasses([row(P), row(S), row(N)], { rule: 'single', of: 1, pass: 3 }).pred, N);
});

test('fail closed: a combined row is failed when one of its passes failed', () => {
  const u = combinePasses([row(N), fail(), row(N)], UNION2);
  assert.deepEqual([u.failed, u.pred, u.why], [true, null, 'exit-1']);
  assert.equal(combinePasses([row(N), row(N), fail()], UNION2).failed, false, 'a failed pass 3 does not touch the decision');
  assert.equal(combinePasses([row(N), row(N), fail()], MAJ3).failed, true);
  assert.throws(() => combinePasses([row(N)], UNION2), /needs 2 pass rows/);
});

test('pass plan: validated shape, decision first, labels', () => {
  assert.equal(passPlan({}), null);
  const plan = passPlan({ passes: PLAN });
  assert.deepEqual(planRules(plan).map((r) => [r.label, r.decision]), [['union-2', true], ['pass-1', false], ['pass-2', false], ['majority-3', false]]);
  assert.equal(ruleLabel(MAJ3), 'majority-3');
  assert.throws(() => passPlan({ passes: { ...PLAN, count: 1 } }), /count/);
  assert.throws(() => passPlan({ passes: { ...PLAN, decision: { rule: 'union', of: 4 } } }), /decision/);
  assert.throws(() => passPlan({ passes: { ...PLAN, decision: { rule: 'vote', of: 2 } } }), /decision/);
  assert.throws(() => passPlan({ passes: { ...PLAN, info: [{ rule: 'single', of: 1 }] } }), /info\[0\]/);
});

const K = '95';
const IDS = blindIds(6);
async function setupPasses(home) {
  const s = await setupBlind(home, { k: K, routes: ['opus-5.5-low'], ids: IDS, supports: { recall: 10, precision: 10 } });
  const rel = `tools/classif/l4/manifests/series-${K}.json`;
  const { floors: _f, ...m } = JSON.parse(readFileSync(path.join(s.repo, rel), 'utf8'));
  writeRepoFile(s.repo, rel, JSON.stringify({ ...m, method: 'gepa', failureCeiling: 0.05, passes: PLAN }));
  commitAll(s.repo, 'multi-pass series');
  return s;
}

test('multi-pass dev and blind: 3 calls per item, one cache per pass, union-2 scored, information rules beside it, resume pays nothing', withTempHome(async (home) => {
  const s = await setupPasses(home);
  try {
    // dev (tuning half): 2 items x 3 passes.
    mkdirSync(path.join(home, 'l3b'), { recursive: true });
    const tuning = ['t-1', 't-2'].map((itemId) => ({ itemId, half: 'tuning', status: 'resolved', code: 'P-DENSITE', verdict: 'pertinent' }));
    writeFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), `${tuning.map((r) => JSON.stringify(r)).join('\n')}\n`);
    for (const t of tuning) appendFileSync(path.join(home, 'l0', 'dev-items.jsonl'), `${JSON.stringify({ itemId: t.itemId, input: `texte ${t.itemId} six logements zone H-9.` })}\n`);
    const { main } = await import('../l4/dev.mjs');
    const restore = swapEnv('FAKE_CLAUDE_NP', 't-2');
    let m;
    try { m = await main(['--series', K, '--concurrency', '1']); } finally { restore(); }
    const dir = path.join(home, 'l4', `series-${K}`);
    for (const p of [1, 2, 3]) for (const t of tuning) assert.ok(existsSync(path.join(dir, `dev-opus-5.5-low.p${p}.${t.itemId}.json`)), `p${p} ${t.itemId}`);
    assert.ok(!existsSync(path.join(dir, 'dev-opus-5.5-low.t-1.json')), 'no single-pass cache in a multi-pass series');
    assert.deepEqual([m.aggregates['opus-5.5-low'].misses, m.aggregates['opus-5.5-low'].verdict], [1, 'fail'], 't-2 missed by every pass');
    assert.equal(m.passes.decisionLabel, 'union-2');
    assert.deepEqual(Object.keys(m.passes.info['opus-5.5-low']).sort(), ['majority-3', 'pass-1', 'pass-2']);
    assert.equal(m.passes.info['opus-5.5-low']['majority-3'].misses, 1);
    const again = await main(['--series', K, '--concurrency', '1']);
    assert.deepEqual(again.aggregates, m.aggregates, 'resume from the pass caches');
    // blind: 6 items x 3 passes, S113 2 items x 3 passes.
    const r = await blindPass(home, { k: K, routes: ['opus-5.5-low'], fake: { FAKE_CLAUDE_NP: 'b-002' }, concurrency: 1 });
    assert.equal(r.error, null, r.error?.stack);
    const intents = r.calls.filter((c) => c.intent);
    assert.equal(intents.filter((c) => c.phase === `l4-blind-s${K}`).length, 18);
    assert.equal(intents.filter((c) => c.phase === `l4-s113-s${K}`).length, 6);
    assert.deepEqual([...new Set(intents.filter((c) => c.phase === `l4-blind-s${K}`).map((c) => c.pass))], [1, 2, 3], 'pass-major order');
    const files = readdirSync(path.join(home, 'blind'));
    assert.ok(files.includes(`blind-s${K}-opus-5.5-low.p3.b-006.json`) && files.includes(`s113-s${K}-opus-5.5-low.p2.eval-1.json`));
    const agg = readAggregates(home, K);
    assert.deepEqual([agg.perRoute['opus-5.5-low'].misses, agg.perRoute['opus-5.5-low'].verdict], [1, 'fail']);
    assert.equal(agg.perRoute['opus-5.5-low'].passes.decisionLabel, 'union-2');
    assert.deepEqual(Object.keys(agg.perRoute['opus-5.5-low'].passes.info).sort(), ['majority-3', 'pass-1', 'pass-2']);
    const blob = JSON.stringify(r.manifest);
    for (const bad of SCORE_KEYS) assert.ok(!blob.includes(bad), `repo manifest must not contain ${bad}`);
    const resumed = await blindPass(home, { k: K, routes: ['opus-5.5-low'], fake: { FAKE_CLAUDE_NP: 'b-002' }, concurrency: 1 });
    assert.equal(resumed.error, null, resumed.error?.stack);
    assert.equal(resumed.calls.length, 0);
    assert.equal(resumed.manifest.aggregatesSha256, r.manifest.aggregatesSha256);
  } finally { s.cleanup(); }
}));

// ---- One-shot guard with the aggregation key (owner 15/11: lifted for the multi-pass union only) ----
const G = '94';
/** Adds series `k` to the fixture repo: same prompt, halves and route as series G, plus `extra`. */
function addSeries(repo, k, extra = {}) {
  const base = JSON.parse(readFileSync(path.join(repo, `tools/classif/l4/manifests/series-${G}.json`), 'utf8'));
  writeRepoFile(repo, `tools/classif/l4/prompts/P${k}.md`, readFileSync(path.join(repo, `tools/classif/l4/prompts/P${G}.md`), 'utf8'));
  writeRepoFile(repo, `tools/classif/l4/manifests/series-${k}.json`, JSON.stringify({ ...base, ...extra }));
  const dev = JSON.parse(readFileSync(path.join(repo, `tools/classif/l4/manifests/series-${G}-dev.json`), 'utf8'));
  writeRepoFile(repo, `tools/classif/l4/manifests/series-${k}-dev.json`, JSON.stringify({ ...dev, series: k }));
  commitAll(repo, `series ${k}`);
}

test('blind guard: single pass never re-runs; the multi-pass union runs once with an owner decision; another series with the same aggregation is refused', withTempHome(async (home) => {
  const s = await setupBlind(home, { k: G, routes: ['opus-5.5-low'], ids: IDS, supports: { recall: 10, precision: 10 } });
  try {
    const rel = `tools/classif/l4/manifests/series-${G}.json`;
    const { floors: _f, ...m } = JSON.parse(readFileSync(path.join(s.repo, rel), 'utf8'));
    writeRepoFile(s.repo, rel, JSON.stringify({ ...m, method: 'gepa', failureCeiling: 0.05 }));
    commitAll(s.repo, 'gepa single');
    const run = (k) => blindPass(home, { k, routes: ['opus-5.5-low'], concurrency: 1 });
    const single = await run(G);
    assert.equal(single.error, null, single.error?.stack);
    assert.ok(!('aggregation' in single.manifest));
    // The same single-pass configuration in another series: still refused.
    addSeries(s.repo, '92');
    const again = await run('92');
    assert.match(String(again.error?.message), /blind run refused: prompt .* already run with claude-opus-5-5\/low \(/);
    assert.equal(again.calls.length, 0);
    // Multi-pass without an owner decision: refused (the guard is lifted only by the owner).
    addSeries(s.repo, '93', { passes: PLAN, bias: 'chosen after reading series 94' });
    const noDecision = await run('93');
    assert.match(String(noDecision.error?.message), /passes=3\/union2 needs an ownerDecision/);
    assert.equal(noDecision.calls.length, 0);
    // With the owner decision: runs once, the blind manifest carries aggregation, bias and decision.
    addSeries(s.repo, '93', { passes: PLAN, bias: 'chosen after reading series 94', ownerDecision: '2026-11-15, owner: lift the guard for the union, bias accepted' });
    const multi = await run('93');
    assert.equal(multi.error, null, multi.error?.stack);
    assert.equal(multi.calls.filter((c) => c.intent && c.phase === 'l4-blind-s93').length, 18);
    assert.deepEqual([multi.manifest.aggregation, multi.manifest.bias, multi.manifest.ownerDecision],
      ['passes=3/union2', 'chosen after reading series 94', '2026-11-15, owner: lift the guard for the union, bias accepted']);
    const { auditOf } = await import('./l4-blind-fixture.mjs');
    assert.ok(auditOf(home).some((e) => e.action === 'blind-run' && e.aggregation === 'passes=3/union2'));
    // Second attempt of series 93: the guard refuses a new run (the executor only resumes, 0 call).
    const { assertBlindRunAllowed } = await import('../lib/blind.mjs');
    assert.throws(() => assertBlindRunAllowed({ promptFile: 'tools/classif/l4/prompts/P93.md', promptSha256: multi.manifest.promptSha256, model: 'claude-opus-5-5', effort: 'low',
      home, aggregation: 'passes=3/union2', ownerDecision: 'x' }), /already run with claude-opus-5-5\/low \(passes=3\/union2\)/);
    const resumed = await run('93');
    assert.equal(resumed.error, null, resumed.error?.stack);
    assert.equal(resumed.calls.length, 0);
    // Another series with the same multi-pass configuration, owner decision included: refused.
    addSeries(s.repo, '91', { passes: PLAN, ownerDecision: 'another decision' });
    const other = await run('91');
    assert.match(String(other.error?.message), /already run with claude-opus-5-5\/low \(passes=3\/union2\)/);
    assert.equal(other.calls.length, 0);
  } finally { s.cleanup(); }
}));
