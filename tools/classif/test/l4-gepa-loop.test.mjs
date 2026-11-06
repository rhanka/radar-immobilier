// GEPA loop (l4/gepa.mjs runGepa), hermetic: temp CLASSIF_HOME in test mode, temp repo via
// CLASSIF_REPO, in-process fake seats (evaluation routes, astra-max mutator, opus-5.5-max
// repair/fallback). The fake evaluation answer depends on a MARK token of the evaluated prompt.
// Synthetic items only; the blind rows of the fake reference must never reach a seat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { runGepa, stratifiedSplit } from '../l4/gepa.mjs';
import { GEPA_ROUTES } from '../l4/gepa-common.mjs';
import { REPAIR_INSTRUCTION } from '../l4/optimise.mjs';
import { readDevItemCache } from '../l4/dev.mjs';
import { buildFingerprints } from '../lib/fingerprint.mjs';
import { sha256 } from '../lib/render.mjs';
import { initTempRepo, withTempHome, writeRepoFile } from './hermetic-helpers.mjs';

const K = '9';
const SALT = 'gepa-salt';
const SEALED = 'the fictional quarry hamlet council adopted bylaw changes allowing triplex dwellings beside the northern orchard lane today';
const RULES = 'Classify each municipal regulatory item by the registry code that best describes its densification effect. '
  + 'Return one JSON object per item with verdict, code, ambiguous and citation. The verdict is the registry partition of the code. ';
const TUNING = [
  ...['p1', 'p2', 'p3'].map((id) => ({ itemId: id, verdict: 'pertinent', code: 'P-DENSITE' })),
  ...['s1', 's2'].map((id) => ({ itemId: id, verdict: 'a_surveiller', code: 'S-CONTRAINTE' })),
  ...['n1', 'n2', 'n3', 'n4', 'n5'].map((id) => ({ itemId: id, verdict: 'non_pertinent', code: 'N-ADMIN' })),
];
const BLIND = ['b1', 'b2'].map((id) => ({ itemId: id, verdict: 'pertinent', code: 'P-DENSITE', half: 'blind', status: 'resolved' }));
const CODE = { pertinent: 'P-DENSITE', a_surveiller: 'S-CONTRAINTE', non_pertinent: 'N-ADMIN' };
const REF = new Map(TUNING.map((r) => [r.itemId, r.verdict]));
// The run split (default seed gepa-s<K>), recomputed here to aim the fake behaviours.
const SPLIT = stratifiedSplit(TUNING.map((r) => ({ ...r, half: 'tuning', status: 'resolved' })), { seed: `gepa-s${K}` });
const PARETO_N = SPLIT.pareto.find((id) => id.startsWith('n'));
const FEEDBACK_P = SPLIT.feedback.find((id) => id.startsWith('p'));

/**
 * Behaviours by MARK: seed → luna-6-low discards every P/S item (misses), every N shown;
 * noisy → 0 miss, every N shown; child → 0 miss, noise on one D_pareto N case only;
 * clean (and flaky*, tooly, made faulty by an override) → 0 miss, 0 noise; bad → glm-5.3-low alone discards one D_feedback P case.
 */
function predict(mark, route, itemId) {
  const ref = REF.get(itemId);
  const shownRef = ref !== 'non_pertinent';
  if (mark.startsWith('seed')) return shownRef && route === 'luna-6-low' ? 'non_pertinent' : shownRef ? ref : 'a_surveiller';
  if (mark.startsWith('noisy')) return shownRef ? ref : 'a_surveiller';
  if (mark.startsWith('child')) return shownRef ? ref : itemId === PARETO_N ? 'a_surveiller' : 'non_pertinent';
  if (/^(clean|flaky|tooly)/.test(mark)) return shownRef ? ref : 'non_pertinent';
  if (mark.startsWith('bad')) return itemId === FEEDBACK_P && route === 'glm-5.3-low' ? 'non_pertinent' : shownRef ? ref : 'non_pertinent';
  throw new Error(`fake seat: unknown mark ${mark}`);
}

function setup(home) {
  const repo = initTempRepo();
  process.env.CLASSIF_REPO = repo;
  for (let i = 0; i <= 4; i++) writeRepoFile(repo, `tools/classif/l4/prompts/P${i}.md`, `${RULES}MARK:seed-${i}\n`);
  const put = (rel, body) => { mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); writeFileSync(path.join(home, rel), body); };
  const ref = [...TUNING.map((r) => ({ ...r, half: 'tuning', status: 'resolved' })), ...BLIND,
    { itemId: 'u1', verdict: 'pertinent', code: 'P-DENSITE', half: 'tuning', status: 'unresolved' }];
  put('l3b/reference-d.jsonl', `${ref.map((r) => JSON.stringify(r)).join('\n')}\n`);
  put('l0/dev-items.jsonl', `${ref.map((r) => JSON.stringify({ itemId: r.itemId, input: r.half === 'blind' ? `BLIND-SECRET ${r.itemId}` : `texte ${r.itemId}` })).join('\n')}\n`);
  put('guard/salt', `${SALT}\n`);
  put('guard/fingerprints.json', JSON.stringify(buildFingerprints(SALT, { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: [SEALED] })));
  return repo;
}

/** Fake seats. `mutation(prompt, n)` gives the mutator answer; `failAt` makes the n-th eval call throw (crash). */
function fakeSeat({ mutation = (_p, n) => `${RULES}MARK:clean-${n}`, crossover = () => `${RULES}MARK:clean-cross`, repair = () => `${RULES}MARK:noisy-repaired`, failAt = null, astraDown = false, override = () => null } = {}) {
  const seen = [];
  let evals = 0;
  let mutations = 0;
  const seat = async (label, prompt) => {
    seen.push({ label, prompt });
    if (GEPA_ROUTES.includes(label)) {
      evals++;
      if (failAt !== null && evals === failAt) throw new Error('fake crash');
      const id = /### item_id: (\S+)/.exec(prompt)[1];
      const mark = /MARK:(\S+)/.exec(prompt)[1];
      const forced = override(label, mark, id);
      if (forced) return { latencyMs: 1, ...forced };
      const verdict = predict(mark, label, id);
      return { code: 0, text: JSON.stringify({ verdict, code: CODE[verdict], citation: `motif ${mark}` }), latencyMs: 1 };
    }
    if (prompt.startsWith(REPAIR_INSTRUCTION)) return { code: 0, text: repair(prompt), latencyMs: 1 };
    if (label === 'astra-max' && astraDown) return { code: 1, text: '', latencyMs: 1 };
    if (prompt.startsWith('You improve')) return { code: 0, text: mutation(prompt, ++mutations), latencyMs: 1 };
    if (prompt.startsWith('You merge')) return { code: 0, text: crossover(prompt), latencyMs: 1 };
    throw new Error(`fake seat: unexpected prompt for ${label}`);
  };
  return { seat, seen, evalCalls: () => seen.filter((s) => GEPA_ROUTES.includes(s.label)), mutatorCalls: () => seen.filter((s) => !GEPA_ROUTES.includes(s.label)) };
}

const calls = (home) => readFileSync(path.join(home, 'l2', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const journal = (home) => readFileSync(path.join(home, 'l4', `gepa-s${K}`, 'iterations.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const outPrompt = (repo) => path.join(repo, 'tools', 'classif', 'l4', 'prompts', `P${K}.md`);
const repoManifest = (repo) => JSON.parse(readFileSync(path.join(repo, 'tools', 'classif', 'l4', 'manifests', `series-${K}-gepa.json`), 'utf8'));
const quiet = () => {};

test('gepa loop: verbatim child repaired, admitted, crossover, 0-miss winner; manifest counts only; dev cache seeded; blind never read', withTempHome(async (home) => {
  const repo = setup(home);
  const f = fakeSeat({ mutation: (_p, n) => (n === 1 ? `${RULES}Rule: ${SEALED}. MARK:noisy-dirty` : `${RULES}MARK:child-${n}`) });
  const m = await runGepa({ home, k: K, maxIterations: 3, maxCalls: 5000, seat: f.seat, log: quiet });
  // Split: 10 resolved tuning rows (unresolved and blind rows excluded), stratified 60/40.
  assert.equal(m.split.feedback + m.split.pareto, 10);
  assert.deepEqual(m.split.strata, { pertinent: { total: 3, feedback: 2, pareto: 1 }, a_surveiller: { total: 2, feedback: 1, pareto: 1 },
    non_pertinent: { total: 5, feedback: 3, pareto: 2 } });
  assert.equal(m.seed, `gepa-s${K}`);
  const j = journal(home);
  assert.deepEqual(j.map((r) => [r.iter, r.kind]), [[0, 'mutation'], [1, 'mutation'], [2, 'crossover']]);
  assert.deepEqual([j[0].status, j[0].reason, j[0].child.repairs, j[0].child.seat], ['admitted', 'fewer-misses', 1, 'astra-max'], 'verbatim child repaired once');
  assert.ok(!readFileSync(path.join(home, 'l4', `gepa-s${K}`, 'candidates', 'i0.json'), 'utf8').includes(SEALED));
  assert.equal(j[1].status, 'admitted');
  assert.equal(j[2].parents.length, 2);
  assert.notEqual(j[2].parents[0], j[2].parents[1]);
  // Final choice: 0 miss on the 10 cases × 5 routes, least noise among the evaluated finalists.
  assert.equal(m.result.status, 'selected');
  assert.equal(m.result.total.misses, 0);
  const evaluated = m.finalists.filter((x) => x.status === 'evaluated' && x.total.misses === 0);
  assert.equal(m.result.total.noise, Math.min(...evaluated.map((x) => x.total.noise)));
  assert.ok(m.finalists.filter((x) => x.id.startsWith('P')).every((x) => x.status === 'excluded'), 'seeds miss on luna-6-low');
  assert.equal(sha256(readFileSync(outPrompt(repo), 'utf8')), m.result.promptSha256);
  assert.deepEqual(repoManifest(repo), m);
  // Repo manifest: counts only, never an item id or an excerpt.
  const blob = JSON.stringify(m);
  for (const id of [...TUNING.map((r) => r.itemId), 'b1', 'b2', 'u1']) assert.ok(!blob.includes(`"${id}"`), `manifest leaks ${id}`);
  assert.ok(!blob.includes('texte'));
  // Seats: only resolved tuning items, never a blind id or blind input; every call is a logged intent.
  for (const s of f.seen) assert.ok(!/BLIND-SECRET|item_id: b\d|item_id: u1/.test(s.prompt), 'blind or unresolved item sent to a seat');
  assert.ok(!existsSync(path.join(home, 'blind')), 'no blind directory touched');
  const intents = calls(home).filter((c) => c.intent);
  assert.equal(intents.length, f.seen.length);
  assert.equal(m.callsSpent, f.seen.length);
  assert.ok(intents.every((c) => c.phase.startsWith(`l4-gepa-s${K}.`)));
  // Dev per-item cache of series K seeded with the winner rows (same prompt bytes).
  const frozenSha = sha256(readFileSync(outPrompt(repo), 'utf8'));
  for (const route of GEPA_ROUTES) {
    for (const r of TUNING) assert.equal(readDevItemCache(path.join(home, 'l4', `series-${K}`), route, r.itemId, K, frozenSha)?.refVerdict, r.verdict);
  }
  // A completed run is frozen: a second call refuses before any seat call.
  const again = fakeSeat();
  await assert.rejects(runGepa({ home, k: K, maxIterations: 3, seat: again.seat, log: quiet }), /refusing to overwrite frozen prompt/);
  assert.equal(again.seen.length, 0);
}));

test('gepa loop: a resumed run replays finished steps without any repeated paid call', withTempHome(async (home) => {
  setup(home);
  // 100 seed calls, then iteration 0: parent 30, child mini-batch 30, child D_pareto 20 → crash on the 180th.
  const first = fakeSeat({ failAt: 180 });
  await assert.rejects(runGepa({ home, k: K, maxIterations: 2, seat: first.seat, log: quiet }), /fake crash/);
  assert.ok(!existsSync(path.join(home, 'l4', `gepa-s${K}`, 'iterations.jsonl')), 'the crashed iteration is not journaled');
  const answered = new Set(first.evalCalls().filter((_s, i) => i !== 179).map((s) => `${s.label}|${s.prompt}`));
  const second = fakeSeat();
  const m = await runGepa({ home, k: K, maxIterations: 2, seat: second.seat, log: quiet });
  assert.equal(m.result.status, 'selected');
  for (const s of second.evalCalls()) assert.ok(!answered.has(`${s.label}|${s.prompt}`), 'an answered evaluation call was paid twice');
  assert.ok(!second.mutatorCalls().some((s) => first.mutatorCalls().some((x) => x.prompt === s.prompt && x.label === s.label)), 'a returned mutation was paid twice');
  assert.deepEqual(journal(home).map((r) => r.iter), [0, 1], 'one journal record per iteration');
}));

test('gepa loop: the run stops cleanly at the call cap and too small a cap refuses before any call', withTempHome(async (home) => {
  const repo = setup(home);
  // Initial population = 5 seeds × 4 D_pareto cases × 5 routes = 100; final reserve = 6 × 5 = 30.
  const tiny = fakeSeat();
  await assert.rejects(runGepa({ home, k: K, maxCalls: 129, seat: tiny.seat, log: quiet }), /MAX_CALLS 129 cannot hold the initial population \(100 calls\) plus one final evaluation \(30\)/);
  assert.equal(tiny.seen.length, 0);
  const f = fakeSeat();
  const m = await runGepa({ home, k: K, maxCalls: 150, seat: f.seat, log: quiet });
  assert.equal(m.stop, 'budget');
  assert.equal(m.iterations.total, 0);
  assert.equal(m.callsSpent, 100);
  // Every seed misses on luna-6-low: no front candidate at 0 miss → no candidate, no fallback.
  assert.equal(m.result.status, 'no-candidate');
  assert.ok(m.finalists.every((x) => x.status === 'excluded' && x.reason === 'misses-on-d-pareto'));
  assert.ok(!existsSync(outPrompt(repo)));
  // A larger cap resumes the same run (same split, seeds cached on D_pareto) and iterates.
  const g = fakeSeat();
  const m2 = await runGepa({ home, k: K, maxCalls: 5000, maxIterations: 1, seat: g.seat, log: quiet });
  assert.equal(m2.iterations.total, 1);
  const seedItems = g.evalCalls().filter((s) => /MARK:seed/.test(s.prompt)).map((s) => /### item_id: (\S+)/.exec(s.prompt)[1]);
  assert.ok(seedItems.length > 0 && seedItems.every((id) => SPLIT.feedback.includes(id)), 'seeds are never re-paid on D_pareto');
  assert.equal(m2.result.status, 'selected');
  assert.ok(m2.callsSpent <= 5000);
}));

test('gepa loop: a miss on a single route keeps every candidate out, result no-candidate', withTempHome(async (home) => {
  const repo = setup(home);
  // Children discard one D_feedback P case on glm-5.3-low only: fewer misses than the seeds (admitted), never 0.
  const f = fakeSeat({ mutation: (_p, n) => `${RULES}MARK:bad-${n}`, crossover: () => `${RULES}MARK:bad-cross` });
  const m = await runGepa({ home, k: K, maxIterations: 2, seat: f.seat, log: quiet });
  assert.equal(m.result.status, 'no-candidate');
  assert.ok(!existsSync(outPrompt(repo)), 'no prompt frozen without a 0-miss candidate');
  assert.ok(!existsSync(path.join(home, 'l4', `series-${K}`)), 'no dev cache seeded');
  const evaluated = m.finalists.filter((x) => x.status === 'evaluated');
  assert.ok(evaluated.length > 0, 'the children reach the final evaluation (0 miss on D_pareto)');
  for (const x of evaluated) {
    assert.equal(x.total.misses, 1);
    assert.equal(x.perRoute['glm-5.3-low'].misses, 1, 'the only miss comes from one route');
    for (const r of GEPA_ROUTES.filter((y) => y !== 'glm-5.3-low')) assert.equal(x.perRoute[r].misses, 0);
  }
}));

test('gepa loop: a child without noise gain is rejected and journaled; astra failure falls back to opus-5.5-max', withTempHome(async (home) => {
  setup(home);
  // Every mutation is "noisy": admitted against a seed (fewer misses), rejected against a noisy parent.
  const f = fakeSeat({ mutation: (_p, n) => `${RULES}MARK:noisy-${n}`, crossover: () => `${RULES}MARK:noisy-cross`, astraDown: true });
  const m = await runGepa({ home, k: K, maxIterations: 6, seat: f.seat, log: quiet });
  const j = journal(home);
  assert.equal(j[0].status, 'admitted');
  assert.ok(j.every((r) => !r.child || r.child.seat === 'opus-5.5-max'), 'fallback seat used when astra-max fails');
  const rejected = j.filter((r) => r.status === 'rejected');
  assert.ok(rejected.length > 0, 'at least one child rejected');
  for (const r of rejected) {
    assert.equal(r.reason, 'no-noise-gain');
    assert.ok(!existsSync(path.join(home, 'l4', `gepa-s${K}`, 'candidates', `${r.child.id}.json`)), 'a rejected child never joins the population');
  }
  assert.equal(m.population.length, 5 + j.filter((r) => r.status === 'admitted').length);
  assert.ok(f.mutatorCalls().some((s) => s.label === 'astra-max'));
}));

const evalCacheFiles = (home, sha) => {
  const d = path.join(home, 'l4', `gepa-s${K}`, 'eval-cache', sha.slice(0, 16));
  return existsSync(d) ? GEPA_ROUTES.flatMap((r) => (existsSync(path.join(d, r)) ? readdirSync(path.join(d, r)) : [])).length : 0;
};
const candidate = (home, id) => JSON.parse(readFileSync(path.join(home, 'l4', `gepa-s${K}`, 'candidates', `${id}.json`), 'utf8'));

test('review B2: invalid answers count as shown, are cached and never stop the run; an out-of-format child is rejected', withTempHome(async (home) => {
  setup(home);
  // glm answers out of format for every seed case (4/4 > the infra allowance): no breaker.
  const override = (label, mark) => (mark.startsWith('junk') || (label === 'glm-5.3-low' && mark.startsWith('seed')) ? { code: 0, text: 'pas de json' } : null);
  const f = fakeSeat({ mutation: (_p, n) => `${RULES}MARK:junk-${n}`, override });
  const m = await runGepa({ home, k: K, maxIterations: 1, seat: f.seat, log: quiet });
  const j = journal(home);
  assert.deepEqual([j[0].status, j[0].reason], ['rejected', 'answer-failures']);
  // The seed parent already fails every glm case (out of format): only the other routes fail 2+ more.
  assert.deepEqual(j[0].child.failureMarginExceeded, GEPA_ROUTES.filter((r) => r !== 'glm-5.3-low'), 'every route failing 2+ more calls than the parent');
  assert.equal(evalCacheFiles(home, j[0].child.sha), 6 * 5, 'invalid answers are cached as answers');
  assert.ok(candidate(home, 'P0').pareto[SPLIT.pareto[0]]['glm-5.3-low'].failed);
  assert.equal(candidate(home, 'P0').pareto[SPLIT.pareto[0]]['glm-5.3-low'].infra, false);
  assert.equal(m.result.status, 'no-candidate');
  const again = fakeSeat({ override });
  await runGepa({ home, k: K, maxIterations: 1, seat: again.seat, log: quiet });
  assert.equal(again.seen.length, 0, 'a resume repays nothing');
}));

test('review B2/m6: infrastructure failures trip the breaker in flight; the resume pays only what was not answered', withTempHome(async (home) => {
  setup(home);
  let down = true;
  const override = (label) => (down && label === 'luna-6-low' ? { code: 1, text: '' } : null);
  const f = fakeSeat({ override });
  await assert.rejects(runGepa({ home, k: K, maxIterations: 1, seat: f.seat, log: quiet }), /route luna-6-low had 2 infrastructure failures on seed-P0 \(> 1 of 4\): no further call launched/);
  const luna = f.evalCalls().filter((s) => s.label === 'luna-6-low');
  assert.equal(luna.length, 2, 'the 3rd and 4th luna calls are never launched');
  down = false;
  const answered = new Set(f.evalCalls().filter((s) => s.label !== 'luna-6-low').map((s) => `${s.label}|${s.prompt}`));
  const g = fakeSeat({ override });
  const m = await runGepa({ home, k: K, maxIterations: 1, seat: g.seat, log: quiet });
  assert.ok(m.result);
  for (const s of g.evalCalls()) assert.ok(!answered.has(`${s.label}|${s.prompt}`), 'an answered call was paid twice');
}));

test('review B1a/m2: a tool-event answer is an uncached infra failure, retried on D_pareto at the resume', withTempHome(async (home) => {
  setup(home);
  const target = SPLIT.pareto[0];
  let tools = true;
  const override = (label, mark, id) => (tools && label === 'sol-6.1-low' && mark === 'seed-1' && id === target
    ? { code: 0, text: JSON.stringify({ verdict: REF.get(id), code: CODE[REF.get(id)] }), toolEvents: 1 } : null);
  await runGepa({ home, k: K, maxCalls: 150, seat: fakeSeat({ override }).seat, log: quiet });
  const row = candidate(home, 'P1').pareto[target]['sol-6.1-low'];
  assert.deepEqual([row.failed, row.infra], [true, true], 'a well-formed answer with a tool event is refused');
  assert.equal(evalCacheFiles(home, candidate(home, 'P1').sha), 4 * 5 - 1, 'the refused answer is not cached');
  tools = false;
  const g = fakeSeat({ override });
  await runGepa({ home, k: K, maxCalls: 150, seat: g.seat, log: quiet });
  assert.deepEqual(g.evalCalls().map((s) => [s.label, /### item_id: (\S+)/.exec(s.prompt)[1]]), [['sol-6.1-low', target]], 'only the infra failure is retried');
  assert.equal(candidate(home, 'P1').pareto[target]['sol-6.1-low'].failed, false);
}));

test('review m1: the loop stops after MAX_SKIPPED consecutive skipped iterations', withTempHome(async (home) => {
  setup(home);
  const m = await runGepa({ home, k: K, maxSkipped: 3, seat: fakeSeat().seat, log: quiet });
  assert.equal(m.stop, 'stagnation');
  assert.deepEqual(journal(home).map((r) => r.status), ['admitted', 'skipped', 'skipped', 'skipped']);
  assert.equal(m.result.status, 'selected');
}));

test('review m3: a changed evaluation context (tuning input) refuses the resume of a run', withTempHome(async (home) => {
  setup(home);
  await runGepa({ home, k: K, maxCalls: 150, seat: fakeSeat().seat, log: quiet });
  const file = path.join(home, 'l0', 'dev-items.jsonl');
  writeFileSync(file, readFileSync(file, 'utf8').replace('texte p1', 'texte p1 modifié'));
  const g = fakeSeat();
  await assert.rejects(runGepa({ home, k: K, maxCalls: 150, seat: g.seat, log: quiet }), /evaluated under another context/);
  assert.equal(g.seen.length, 0);
}));

const FEEDBACK_N = SPLIT.feedback.filter((id) => id.startsWith('n'));
const PARETO_P = SPLIT.pareto.find((id) => id.startsWith('p'));

test('review R1: a child with one failure more than its parent is admitted; two more is rejected; over 5 % on D_pareto it stays but is ineligible', withTempHome(async (home) => {
  setup(home);
  // flaky1: glm out of format on 1 D_feedback case (+1 vs the seed parent) and on 1 D_pareto case (1/4 > 5 %).
  // flaky2: glm out of format on the 3 D_feedback N cases (+2 at least, whichever parent: seed 0 or i0 1).
  const junk = { code: 0, text: 'pas de json' };
  const override = (label, mark, id) => {
    if (label !== 'glm-5.3-low') return null;
    if (mark.startsWith('flaky1') && (id === FEEDBACK_N[0] || id === PARETO_P)) return junk;
    if (mark.startsWith('flaky2') && FEEDBACK_N.includes(id)) return junk;
    return null;
  };
  const f = fakeSeat({ mutation: (_p, n) => `${RULES}MARK:${n === 1 ? 'flaky1' : 'flaky2'}-${n}`, override });
  const m = await runGepa({ home, k: K, maxIterations: 2, seat: f.seat, log: quiet });
  const j = journal(home);
  assert.deepEqual([j[0].status, j[0].reason, j[0].child.ineligible], ['admitted', 'fewer-misses', ['glm-5.3-low']]);
  assert.deepEqual([j[1].status, j[1].reason, j[1].child.failureMarginExceeded], ['rejected', 'answer-failures', ['glm-5.3-low']]);
  assert.ok(m.population.some((c) => c.id === 'i0'), 'the ineligible child stays in the population');
  const fin = m.finalists.find((x) => x.id === 'i0');
  assert.deepEqual([fin.status, fin.reason], ['excluded', 'failure-ceiling-on-d-pareto']);
  assert.equal(m.result.status, 'no-candidate');
}));

test('review R2: a child whose answers carry tool events is rejected and consumed, no breaker, nothing cached, no repaid call', withTempHome(async (home) => {
  setup(home);
  const tool = (label, mark, id) => (mark.startsWith('tooly') && label === 'sol-6.1-low'
    ? { code: 0, text: JSON.stringify({ verdict: REF.get(id), code: CODE[REF.get(id)] }), toolEvents: 2 } : null);
  // Every mutation returns the same child: iteration 1 receives it again and must not evaluate it.
  const f = fakeSeat({ mutation: () => `${RULES}MARK:tooly`, override: tool });
  const m = await runGepa({ home, k: K, maxIterations: 2, seat: f.seat, log: quiet });
  const j = journal(home);
  assert.deepEqual([j[0].status, j[0].reason, j[0].child.consumed], ['rejected', 'tool-events', true]);
  assert.equal(j[0].child.toolEvents, 6, 'every sol answer of the 6-case mini-batch carried tool events');
  assert.deepEqual([j[1].status, j[1].reason], ['rejected', 'tool-events-consumed']);
  const childCalls = f.evalCalls().filter((s) => /MARK:tooly/.test(s.prompt));
  assert.equal(childCalls.length, 6 * 5, 'the consumed child is evaluated once, on its mini-batch only');
  assert.equal(evalCacheFiles(home, j[0].child.sha), 6 * 4, 'the tool-event answers are not cached');
  assert.ok(m.result);
  const again = fakeSeat({ mutation: () => `${RULES}MARK:tooly`, override: tool });
  await runGepa({ home, k: K, maxIterations: 2, seat: again.seat, log: quiet });
  assert.equal(again.seen.length, 0, 'a resume repays nothing');
}));

test('review R5: a breaker stop on authentication errors names the seat refresh and the exact resume command', withTempHome(async (home) => {
  setup(home);
  const override = (label) => (label === 'luna-6-low' ? { code: 1, text: '', authError: true } : null);
  await assert.rejects(runGepa({ home, k: K, maxCalls: 900, seat: fakeSeat({ override }).seat, log: quiet }),
    (e) => e.message.includes('`make classif-seat-auth-refresh SEAT=luna-6-low ENV=preprod`')
      && e.message.includes(`\`make classif-l4-gepa SERIES=${K} MAX_CALLS=900 RUN=s${K} SEED='gepa-s${K}' ENV=preprod\``));
}));
