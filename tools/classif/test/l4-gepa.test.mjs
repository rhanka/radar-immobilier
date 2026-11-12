// GEPA method, pure rules (owner-validated method): stratified split, per-case Pareto front,
// admission, any-route miss, final choice, run budget, blind firewall, GEPA seats and series
// shape. Synthetic data only, no seat call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  admissionDecision, assertTuningRows, buildCrossoverPrompt, buildReflectionPrompt, buildTraces, finalChoice,
  paretoFront, rngFor, sampleFromFront, selectMinibatch, stratifiedSplit,
} from '../l4/gepa.mjs';
import { GEPA_ROUTES, caseScore, gepaRouteVerdict, gepaSeriesVerdict, routeOutcome } from '../l4/gepa-common.mjs';
import { ROUTES, codexHomeDir, isCodexSeat, parseCodex } from '../run-seat.mjs';
import { seatFamily } from '../l4/families.mjs';
import { runBudget, spentByPrefix } from '../lib/budget.mjs';
import { assertGepaSeriesShape } from '../l4/series.mjs';
import { CLASSIF_DIR, withTempHome } from './hermetic-helpers.mjs';

const rows = (counts) => Object.entries(counts).flatMap(([verdict, n]) => Array.from({ length: n }, (_, i) => ({
  itemId: `${verdict.slice(0, 1)}-${String(i).padStart(3, '0')}`, verdict, code: 'X', half: 'tuning', status: 'resolved' })));
const S = (misses, noise, failures = 0) => ({ misses, noise, failures });
const P = (verdict) => ({ verdict, failed: false });

test('gepa split: deterministic for a recorded seed, stratified, disjoint and ~150/~100 on 252 cases', () => {
  const r = rows({ pertinent: 40, a_surveiller: 60, non_pertinent: 152 });
  const a = stratifiedSplit(r, { seed: 'seed-1' });
  const b = stratifiedSplit([...r].reverse(), { seed: 'seed-1' });
  assert.deepEqual(a, b, 'same seed, same rows (any order) → same split');
  assert.equal(a.seed, 'seed-1');
  assert.deepEqual(a.strata, { pertinent: { total: 40, feedback: 24, pareto: 16 }, a_surveiller: { total: 60, feedback: 36, pareto: 24 },
    non_pertinent: { total: 152, feedback: 91, pareto: 61 } });
  assert.equal(a.feedback.length, 151);
  assert.equal(a.pareto.length, 101);
  assert.equal(new Set([...a.feedback, ...a.pareto]).size, 252, 'disjoint and covering');
  const c = stratifiedSplit(r, { seed: 'seed-2' });
  assert.notDeepEqual(c.feedback, a.feedback, 'another seed draws another split');
  assert.deepEqual(c.strata, a.strata, 'the proportions per verdict do not depend on the seed');
  assert.throws(() => stratifiedSplit(r, {}), /recorded seed is required/);
});

test('gepa firewall: the split and the prompt builders refuse anything from the blind half', () => {
  const r = rows({ pertinent: 2, non_pertinent: 2 });
  assert.throws(() => stratifiedSplit([...r, { itemId: 'b-1', verdict: 'pertinent', half: 'blind', status: 'resolved' }], { seed: 's' }), /gepa firewall: refusing a non-tuning row \(b-1, half blind\)/);
  assert.throws(() => assertTuningRows([{ itemId: 'u-1', verdict: 'pertinent', status: 'resolved' }]), /gepa firewall/);
  assert.throws(() => assertTuningRows([{ ...r[0], status: 'unresolved' }]), /not resolved/);
  const trace = { itemId: 't-1', half: 'tuning', kind: 'miss', count: 1, expected: { code: 'P-DENSITE', verdict: 'pertinent' }, excerpt: 'x',
    predictions: [{ route: 'opus-5.5-low', failed: false, code: 'N-ADMIN', verdict: 'non_pertinent', justification: '' }] };
  assert.match(buildReflectionPrompt({ parentPrompt: 'PARENT', traces: [trace] }), /MISS on 1\/1 model/);
  for (const bad of ['blindRows', 'blindAggregates', 'sealed', 'tuningRef']) {
    assert.throws(() => buildReflectionPrompt({ parentPrompt: 'p', traces: [], [bad]: {} }), /gepa firewall: refusing reflection material/, bad);
    assert.throws(() => buildCrossoverPrompt({ promptA: 'a', promptB: 'b', [bad]: {} }), /gepa firewall: refusing crossover material/, bad);
  }
  assert.throws(() => buildReflectionPrompt({ parentPrompt: 'p', traces: [{ ...trace, half: 'blind' }] }), /non-tuning trace/);
  // The module never opens the blind half: no blind helper import, no blind path.
  const src = readFileSync(path.join(CLASSIF_DIR, 'l4', 'gepa.mjs'), 'utf8');
  for (const forbidden of ['lib/blind.mjs', 'openBlindSet', 'CLASSIF_BLIND_KEY', "'blind'", 'evalset']) assert.ok(!src.includes(forbidden), `gepa.mjs must not reference ${forbidden}`);
});

test('gepa score: a miss on a single route counts, a failed call counts as shown, P<->S is not penalised', () => {
  const allShown = Object.fromEntries(GEPA_ROUTES.map((r) => [r, P('pertinent')]));
  assert.deepEqual(caseScore('pertinent', allShown), S(0, 0));
  assert.deepEqual(caseScore('pertinent', { ...allShown, 'sol-6.1-low': P('non_pertinent') }), S(1, 0), 'one route out of two is a miss');
  assert.deepEqual(caseScore('a_surveiller', { ...allShown, 'opus-5.5-low': P('non_pertinent'), 'sol-6.1-low': P('non_pertinent') }), S(2, 0));
  assert.deepEqual(caseScore('a_surveiller', allShown), S(0, 0), 'P predicted for an S reference is not penalised');
  assert.deepEqual(caseScore('pertinent', { ...allShown, 'opus-5.5-low': { failed: true } }), S(0, 0, 1), 'a failure is shown, never a miss');
  assert.deepEqual(caseScore('non_pertinent', { ...allShown, 'opus-5.5-low': { failed: true } }), S(0, 2, 1), 'a failure on an N reference is noise');
  assert.deepEqual(caseScore('non_pertinent', Object.fromEntries(GEPA_ROUTES.map((r) => [r, P('non_pertinent')]))), S(0, 0));
  assert.deepEqual(caseScore('pertinent', { 'opus-5.5-low': P('pertinent') }), S(0, 0, 1), 'a missing route counts as a failed call');
  assert.deepEqual(routeOutcome('pertinent', null), { miss: 0, noise: 0, failed: 1 });
});

test('gepa front: best per case with ties kept, a never-best prompt drops out, draw weighted by cases won', () => {
  const ids = ['c1', 'c2', 'c3', 'c4'];
  const cands = [
    { id: 'A', scores: { c1: S(0, 1), c2: S(0, 0), c3: S(1, 0), c4: S(0, 0) } },
    { id: 'B', scores: { c1: S(0, 0), c2: S(0, 0), c3: S(1, 0), c4: S(0, 2) } },
    { id: 'C', scores: { c1: S(0, 2), c2: S(1, 0), c3: S(2, 0), c4: S(0, 1) } },
    { id: 'D', scores: { c1: S(1, 0), c2: S(0, 3), c3: S(0, 5), c4: S(0, 3) } },
  ];
  // c1 → B (0,0); c2 → A,B tie; c3 → D (0 miss beats any noise); c4 → A.
  assert.deepEqual(paretoFront(cands, ids), [{ id: 'A', wins: 2 }, { id: 'B', wins: 2 }, { id: 'D', wins: 1 }]);
  assert.ok(!paretoFront(cands, ids).some((f) => f.id === 'C'), 'C is never the best: out of the front');
  const front = paretoFront(cands, ids);
  const at = (x) => sampleFromFront(front, () => x);
  assert.deepEqual([at(0), at(0.39), at(0.41), at(0.79), at(0.81), at(0.999)], ['A', 'A', 'B', 'B', 'D', 'D'], 'weights 2/5, 2/5, 1/5');
  assert.equal(sampleFromFront(front, () => 0, { exclude: ['A'] }), 'B');
  const draws = Array.from({ length: 5 }, (_, i) => sampleFromFront(front, rngFor('seed', 'iteration', i)));
  assert.deepEqual(draws, Array.from({ length: 5 }, (_, i) => sampleFromFront(front, rngFor('seed', 'iteration', i))), 'seeded draws replay');
  assert.throws(() => paretoFront([{ id: 'X', scores: {} }], ['c1']), /no score for case c1/);
});

test('gepa admission: more misses rejected, equal misses need strictly less noise, fewer misses admitted', () => {
  assert.deepEqual(admissionDecision(S(2, 0), S(1, 9)), { admitted: false, reason: 'more-misses' });
  assert.deepEqual(admissionDecision(S(1, 3), S(1, 3)), { admitted: false, reason: 'no-noise-gain' });
  assert.deepEqual(admissionDecision(S(1, 4), S(1, 3)), { admitted: false, reason: 'no-noise-gain' });
  assert.deepEqual(admissionDecision(S(1, 2), S(1, 3)), { admitted: true, reason: 'less-noise' });
  assert.deepEqual(admissionDecision(S(0, 40), S(1, 0)), { admitted: true, reason: 'fewer-misses' });
});

test('gepa mini-batch: known misses first, then known noise, then seeded fill, D_feedback only', () => {
  const fb = Array.from({ length: 50 }, (_, i) => `f-${String(i).padStart(2, '0')}`);
  const mb = selectMinibatch(fb, { misses: ['f-07', 'f-03', 'x-pareto'], noise: ['f-09', 'f-03'] }, rngFor('s', 1));
  assert.equal(mb.length, 30);
  assert.deepEqual(new Set(mb.slice(0, 2)), new Set(['f-07', 'f-03']));
  assert.equal(mb[2], 'f-09');
  assert.ok(!mb.includes('x-pareto'), 'a D_pareto case never enters the mini-batch');
  assert.equal(new Set(mb).size, 30);
  assert.deepEqual(mb, selectMinibatch(fb, { misses: ['f-07', 'f-03', 'x-pareto'], noise: ['f-09', 'f-03'] }, rngFor('s', 1)));
  assert.equal(selectMinibatch(fb.slice(0, 6), {}, rngFor('s', 2)).length, 6);
});

test('gepa traces: misses first then noise, with expected, prediction and justification per route', () => {
  const refById = new Map([['n1', { verdict: 'non_pertinent', code: 'N-ADMIN', half: 'tuning', input: 'texte n1' }],
    ['p1', { verdict: 'pertinent', code: 'P-DENSITE', half: 'tuning', input: 'texte p1' }],
    ['p2', { verdict: 'pertinent', code: 'P-DENSITE', half: 'tuning', input: 'texte p2' }]]);
  const row = (verdict, j = '') => ({ failed: false, pred: { verdict, code: verdict === 'non_pertinent' ? 'N-ADMIN' : 'P-DENSITE' }, justification: j });
  const all = (v) => Object.fromEntries(GEPA_ROUTES.map((r) => [r, row(v)]));
  const traces = buildTraces({ n1: all('pertinent'), p1: { ...all('pertinent'), 'sol-6.1-low': row('non_pertinent', 'rien de résidentiel') }, p2: all('pertinent') }, refById);
  assert.deepEqual(traces.map((t) => [t.itemId, t.kind, t.count]), [['p1', 'miss', 1], ['n1', 'noise', 2]]);
  assert.equal(traces[0].predictions.find((p) => p.route === 'sol-6.1-low').justification, 'rien de résidentiel');
  assert.equal(traces[0].excerpt, 'texte p1');
});

test('gepa final choice: only 0 miss in total is retained, least noise wins, none gives no candidate', () => {
  const f = (id, misses, noise, rank, status = 'evaluated') => ({ id, rank, status, total: { misses, noise, failures: 0 } });
  assert.equal(finalChoice([f('A', 0, 9, 0), f('B', 1, 0, 1), f('C', 0, 4, 2)]).id, 'C');
  assert.equal(finalChoice([f('A', 0, 4, 0), f('C', 0, 4, 2)]).id, 'A', 'tie on noise: rank order');
  assert.equal(finalChoice([f('A', 1, 0, 0), f('B', 3, 0, 1)]), null, 'no 0-miss finalist → no candidate, no fallback');
  assert.equal(finalChoice([{ id: 'X', rank: 0, status: 'not-covered', pareto: S(0, 0) }]), null);
});

test('gepa verdicts: a route passes only with 0 miss and failures within 5 %; the series needs every route', () => {
  assert.equal(gepaRouteVerdict({ misses: 0, failures: 5, items: 100 }).verdict, 'pass');
  assert.equal(gepaRouteVerdict({ misses: 0, failures: 6, items: 100 }).verdict, 'fail');
  assert.equal(gepaRouteVerdict({ misses: 1, failures: 0, items: 100 }).verdict, 'fail');
  const pass = Object.fromEntries(GEPA_ROUTES.map((r) => [r, { verdict: 'pass' }]));
  assert.equal(gepaSeriesVerdict(pass).verdict, 'pass');
  assert.deepEqual(gepaSeriesVerdict({ ...pass, 'sol-6.1-low': { verdict: 'fail' } }), { verdict: 'fail', missing: [], failing: ['sol-6.1-low'] });
  assert.deepEqual(GEPA_ROUTES, ['opus-5.5-low', 'sol-6.1-low'], 'owner: sol, not luna (06/11); no Vibe route (12/11)');
  assert.ok(!GEPA_ROUTES.includes('glm-5.3-low') && !GEPA_ROUTES.includes('mistral-large-4-low'), 'owner 12/11: no Vibe route');
  assert.ok(!GEPA_ROUTES.includes('luna-6-low'));
  const { 'opus-5.5-low': _gone, ...rest } = pass;
  assert.deepEqual(gepaSeriesVerdict(rest).missing, ['opus-5.5-low']);
});

test('gepa run budget: counts the run phases only, caps the run under the pilot cap, fails closed', withTempHome(async (home) => {
  mkdirSync(path.join(home, 'l2'), { recursive: true });
  const lines = [{ intent: true, phase: 'l4-gepa-s5.eval' }, { intent: false, phase: 'l4-gepa-s5.eval' }, { intent: true, phase: 'l4-gepa-s5.i0-mutation' },
    { intent: true, phase: 'l4-gepa-s50.eval' }, { intent: true, phase: 'l4-dev-s4' }];
  writeFileSync(path.join(home, 'l2', 'calls.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  assert.equal(spentByPrefix(home, 'l4-gepa-s5.'), 2, 'result records and other runs are not counted');
  const b = runBudget(home, { prefix: 'l4-gepa-s5.', cap: 10 });
  assert.equal(b.spent(), 2);
  assert.equal(b.remaining(), 8);
  assert.ok(b.fits(8) && !b.fits(9));
  assert.throws(() => b.check(9), /run budget refused: 2 run calls spent \(cap 10\)/);
  assert.equal(runBudget(home, { prefix: 'l4-gepa-s5.', cap: 1000, pilotCap: 7 }).remaining(), 3, 'the pilot cap still binds');
  assert.throws(() => runBudget(home, { prefix: 'x.', cap: 0 }), /positive integer/);
}));

test('codex seats: sol-6.1-low/medium, luna-6-low, astra-low/medium on the isolated codex route, mistral-large-4-low generated by LEVELS', withTempHome(async (home) => {
  for (const [label, model, effort, family] of [['sol-6.1-low', 'gpt-6.1-sol', 'low', 'codex'], ['sol-6.1-medium', 'gpt-6.1-sol', 'medium', 'codex'],
    ['luna-6-low', 'gpt-6-luna', 'low', 'codex'], ['luna-6-medium', 'gpt-6-luna', 'medium', 'codex'], ['astra-low', 'gpt-6-astra', 'low', 'astra'], ['astra-medium', 'gpt-6-astra', 'medium', 'astra']]) {
    const r = ROUTES[label];
    assert.ok(r, `${label} registered`);
    assert.equal(r.model, model);
    assert.equal(r.effort, effort);
    assert.ok(isCodexSeat(label), `${label} is under the ChatGPT quota guard`);
    assert.equal(r.parse, parseCodex);
    const work = path.join(home, `work-${label}`);
    mkdirSync(work);
    const built = r.build(work, path.join(work, 'prompt.md'), 'synthetic prompt');
    assert.equal(built.cmd, 'codex');
    assert.deepEqual(built.args.slice(0, 7), ['exec', '-m', model, '-c', `model_reasoning_effort=${effort}`, '-s', 'read-only']);
    for (const f of ['--skip-git-repo-check', '--json', '-o']) assert.ok(built.args.includes(f), f);
    assert.ok(!built.args.includes('--ephemeral'), 'the session file is the quota source (read then deleted)');
    assert.ok(built.args.includes(path.join(work, 'last-message.md')));
    assert.equal(built.args[built.args.length - 1], '-', 'prompt on stdin');
    assert.equal(built.stdin, 'synthetic prompt');
    assert.equal(built.env.CODEX_HOME, codexHomeDir(label), 'own CODEX_HOME per seat');
    assert.ok(!built.env.CODEX_HOME.startsWith(home), 'outside CLASSIF_HOME');
    const cfg = readFileSync(path.join(built.env.CODEX_HOME, 'config.toml'), 'utf8');
    assert.ok(!/^\s*\[mcp_servers/m.test(cfg), 'no mcp_servers');
    assert.match(cfg, new RegExp(`model = "${model}"`));
    assert.match(cfg, new RegExp(`model_reasoning_effort = "${effort}"`));
    assert.equal(readFileSync(path.join(built.env.CODEX_HOME, 'auth.json'), 'utf8'), '{"fake":"auth-for-hermetic-tests"}');
    assert.equal(seatFamily(label), family);
  }
  assert.notEqual(codexHomeDir('sol-6.1-low'), codexHomeDir('luna-6-low'));
  assert.equal(new Set(['astra-max', 'astra-low', 'astra-medium', 'sol-6.1-low', 'sol-6.1-medium'].map((s) => codexHomeDir(s))).size, 5, 'one CODEX_HOME per seat');
  assert.equal(codexHomeDir('astra-max'), path.join(process.env.CLASSIF_SEAT_HOMES, 'astra-max'));
  assert.equal(ROUTES['mistral-large-4-low'].effort, 'low');
  assert.match(ROUTES['mistral-large-4-low'].route, /VIBE_HOME=<classif>\/vibe\/low/);
  for (const r of GEPA_ROUTES) assert.ok(ROUTES[r], `${r} is a run-seat route`);
  assert.equal(process.env.CLASSIF_TEST_MODE, '1');
}));

test('gepa series shape: a non-empty subset of the GEPA routes, ceiling <= 5 %, no floors, no recallNonRegression', () => {
  const ok = { routes: [...GEPA_ROUTES].reverse(), failureCeiling: 0.05 };
  assert.doesNotThrow(() => assertGepaSeriesShape(ok, 5));
  assert.doesNotThrow(() => assertGepaSeriesShape({ ...ok, routes: ['sol-6.1-low'] }, 6), 'owner 12/11: single-route series P0 × sol');
  assert.doesNotThrow(() => assertGepaSeriesShape({ ...ok, routes: ['astra-low', 'astra-medium', 'sol-6.1-low', 'sol-6.1-medium'] }, 7), 'owner 12/11: P0 on Astra and Sol low/medium');
  assert.throws(() => assertGepaSeriesShape({ ...ok, routes: ['astra-max'] }, 7), /non-empty subset/, 'a max seat is never an evaluated route');
  assert.doesNotThrow(() => assertGepaSeriesShape({ ...ok, routes: ['luna-6-low', 'luna-6-medium'] }, 8), 'owner 12/11: P0 on Luna low/medium');
  assert.ok(!GEPA_ROUTES.includes('luna-6-low'), 'optimisation routes unchanged: sol, not luna');
  assert.throws(() => assertGepaSeriesShape({ ...ok, routes: [] }, 5), /non-empty subset/);
  assert.throws(() => assertGepaSeriesShape({ ...ok, routes: ['sol-6.1-low', 'sol-6.1-low'] }, 5), /without duplicates/);
  assert.throws(() => assertGepaSeriesShape({ ...ok, routes: [...GEPA_ROUTES, 'opus-5.5-medium'] }, 5), /non-empty subset/);
  assert.throws(() => assertGepaSeriesShape({ ...ok, routes: ['glm-5.3-low'] }, 5), /non-empty subset/);
  assert.throws(() => assertGepaSeriesShape({ ...ok, failureCeiling: 0.1 }, 5), /failureCeiling must be in \]0,0.05\]/);
  assert.throws(() => assertGepaSeriesShape({ ...ok, floors: { recall: 0.8, precision: 0.5 } }, 5), /no floors/);
  assert.throws(() => assertGepaSeriesShape({ ...ok, recallNonRegression: { baselineSeries: 0 } }, 5), /own verdict/);
});
