// GEPA re-review 2 (review-gepa-972, « Re-revue 2 »): persistent failures on a realistic
// D_pareto (48 cases) never block the run (B3), retries are bounded (B3b), a parent with tool
// events skips its iteration (B3e), the infra breaker uses the whole batch (B3d), vibe tool
// calls fail closed (V1). Hermetic: temp home, temp repo, in-process fake seats, no paid call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { MAX_RETRIES, runGepa, stratifiedSplit } from '../l4/gepa.mjs';
import { GEPA_ROUTES } from '../l4/gepa-common.mjs';
import { parseSeatResult } from '../l4/dev.mjs';
import { ROUTES, codexErrorEnvelope, countVibeToolEvents, looksLikeMaxPrice, looksLikeQuotaFailure } from '../run-seat.mjs';
import { loadCodes } from '../l2/run.mjs';
import { buildFingerprints } from '../lib/fingerprint.mjs';
import { initTempRepo, withTempHome, writeRepoFile } from './hermetic-helpers.mjs';

const K = '9';
const RULES = 'Classify each municipal regulatory item by the registry code that best describes its densification effect. '
  + 'Return one JSON object per item with verdict, code, ambiguous and citation. The verdict is the registry partition of the code. ';
const CODE = { pertinent: 'P-DENSITE', a_surveiller: 'S-CONTRAINTE', non_pertinent: 'N-ADMIN' };
const TUNING = [...Array.from({ length: 40 }, (_, i) => ({ itemId: `p${i}`, verdict: 'pertinent' })),
  ...Array.from({ length: 80 }, (_, i) => ({ itemId: `n${i}`, verdict: 'non_pertinent' }))].map((r) => ({ ...r, code: CODE[r.verdict] }));
const REF = new Map(TUNING.map((r) => [r.itemId, r.verdict]));
const SPLIT = stratifiedSplit(TUNING.map((r) => ({ ...r, half: 'tuning', status: 'resolved' })), { seed: `gepa-s${K}` });
const TOOL_IDS = SPLIT.pareto.slice(0, 2);
const quiet = () => {};

function setup(home) {
  const repo = initTempRepo();
  process.env.CLASSIF_REPO = repo;
  for (let i = 0; i <= 4; i++) writeRepoFile(repo, `tools/classif/l4/prompts/P${i}.md`, `${RULES}MARK:seed-${i}\n`);
  const put = (rel, body) => { mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); writeFileSync(path.join(home, rel), body); };
  const ref = TUNING.map((r) => ({ ...r, half: 'tuning', status: 'resolved' }));
  put('l3b/reference-d.jsonl', `${ref.map((r) => JSON.stringify(r)).join('\n')}\n`);
  put('l0/dev-items.jsonl', `${ref.map((r) => JSON.stringify({ itemId: r.itemId, input: `texte ${r.itemId}` })).join('\n')}\n`);
  put('guard/salt', 's\n');
  put('guard/fingerprints.json', JSON.stringify(buildFingerprints('s', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['the fictional quarry hamlet council adopted bylaw changes allowing triplex dwellings beside the northern orchard lane today'] })));
  return repo;
}

/** Fake seats: correct answers unless `override(label, mark, id)` returns a seat result. */
function fakeSeat(override = () => null) {
  const seen = [];
  const seat = async (label, prompt) => {
    if (!GEPA_ROUTES.includes(label)) return { code: 0, text: `${RULES}MARK:clean-x`, latencyMs: 1 };
    const id = /### item_id: (\S+)/.exec(prompt)[1];
    const mark = /MARK:(\S+)/.exec(prompt)[1];
    seen.push({ label, id, mark });
    const forced = override(label, mark, id);
    if (forced) return { latencyMs: 1, ...forced };
    const v = REF.get(id);
    return { code: 0, text: JSON.stringify({ verdict: v, code: CODE[v] }), latencyMs: 1 };
  };
  return { seat, seen };
}
const okAnswer = (id) => ({ code: 0, text: JSON.stringify({ verdict: REF.get(id), code: CODE[REF.get(id)] }) });
const manifestFile = (repo) => path.join(repo, 'tools', 'classif', 'l4', 'manifests', `series-${K}-gepa.json`);
const journal = (home) => readFileSync(path.join(home, 'l4', `gepa-s${K}`, 'iterations.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('B3 (retry-trip replay): 2 persistent tool events on a 48-case D_pareto never stop the run, which writes its manifest', withTempHome(async (home) => {
  const repo = setup(home);
  assert.ok(SPLIT.pareto.length >= 40);
  const tool = (label, mark, id) => (mark === 'seed-1' && label === 'sol-6.1-low' && TOOL_IDS.includes(id) ? { ...okAnswer(id), toolEvents: 1 } : null);
  const f = fakeSeat(tool);
  const m = await runGepa({ home, k: K, maxIterations: 0, seat: f.seat, log: quiet });
  assert.ok(existsSync(manifestFile(repo)), 'manifest written');
  assert.equal(m.result.status, 'selected');
  const p1 = m.finalists.find((x) => x.id === 'P1');
  assert.ok(p1, 'P1 stays on the front');
  const toolCalls = f.seen.filter((s) => s.mark === 'seed-1' && s.label === 'sol-6.1-low' && TOOL_IDS.includes(s.id));
  assert.equal(toolCalls.length, 2 * 2, 'each failed pair: first call + one retry before the final, never a breaker');
}));

test('B3b: retries are bounded per (candidate, route, case) over the run; past the bound the failure is definitive', withTempHome(async (home) => {
  setup(home);
  // Every seed misses p0 on mistral (no candidate, so the run can be resumed); P1 keeps 2 persistent tool events.
  const override = (label, mark, id) => {
    if (mark.startsWith('seed') && label === 'mistral-large-4-low' && id === 'p0') return { code: 0, text: JSON.stringify({ verdict: 'non_pertinent', code: CODE.non_pertinent }) };
    if (mark === 'seed-1' && label === 'sol-6.1-low' && TOOL_IDS.includes(id)) return { ...okAnswer(id), toolEvents: 1 };
    return null;
  };
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const f = fakeSeat(override);
    const m = await runGepa({ home, k: K, maxIterations: 0, seat: f.seat, log: quiet });
    assert.equal(m.result.status, 'no-candidate');
    runs.push(f.seen.filter((s) => s.mark === 'seed-1' && s.label === 'sol-6.1-low' && TOOL_IDS.includes(s.id)).length);
  }
  assert.deepEqual(runs, [4, 2, 0], 'run 1: first call + retry 1; run 2: retry 2; run 3: nothing');
  assert.equal(runs.reduce((a, b) => a + b, 0), 2 * (1 + MAX_RETRIES));
  const retries = JSON.parse(readFileSync(path.join(home, 'l4', `gepa-s${K}`, 'retries.json'), 'utf8'));
  assert.deepEqual(Object.values(retries), [MAX_RETRIES, MAX_RETRIES]);
  const p1 = JSON.parse(readFileSync(path.join(home, 'l4', `gepa-s${K}`, 'candidates', 'P1.json'), 'utf8'));
  for (const id of TOOL_IDS) assert.deepEqual([p1.pareto[id]['sol-6.1-low'].failed, p1.pareto[id]['sol-6.1-low'].tool], [true, true], 'definitive failure kept');
}));

test('B3d: the infra breaker counts over the whole batch (48 cases: 2 failures pass, 3 stop the run)', withTempHome(async (home) => {
  setup(home);
  const down = (n) => (label, mark, id) => (mark === 'seed-0' && label === 'opus-5.5-low' && SPLIT.pareto.slice(0, n).includes(id) ? { code: 1, text: '' } : null);
  await assert.rejects(runGepa({ home, k: K, maxIterations: 0, seat: fakeSeat(down(3)).seat, log: quiet }), /route opus-5.5-low had 3 infrastructure failures on seed-P0 \(> 2 of 48\)/);
  const home2 = mkdtempSync(path.join(os.tmpdir(), 'b3-home-'));
  try {
    setup(home2);
    const m = await runGepa({ home: home2, k: K, maxIterations: 0, seat: fakeSeat(down(2)).seat, log: quiet });
    assert.ok(m.result);
  } finally { rmSync(home2, { recursive: true, force: true }); }
}));

test('B3e: a parent with tool events on its mini-batch skips the iteration (journaled), the run ends with its manifest', withTempHome(async (home) => {
  const repo = setup(home);
  const override = (label, mark, id) => (mark.startsWith('seed') && label === 'sol-6.1-low' && SPLIT.feedback.includes(id) ? { ...okAnswer(id), toolEvents: 1 } : null);
  const m = await runGepa({ home, k: K, maxIterations: 2, seat: fakeSeat(override).seat, log: quiet });
  assert.deepEqual(journal(home).map((r) => [r.status, r.reason]), [['skipped', 'parent-tool-events'], ['skipped', 'parent-tool-events']]);
  assert.ok(journal(home).every((r) => r.toolEvents > 0));
  assert.ok(existsSync(manifestFile(repo)));
  // The seeds fail every sol D_feedback call: over the 5 % share, none is retained.
  assert.equal(m.result.status, 'no-candidate');
}));

test('V1: vibe tool calls and tool messages count as tool events and fail the call', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vibe-parse-'));
  try {
    const answer = JSON.stringify({ verdict: 'pertinent', code: 'P-DENSITE' });
    const withTools = JSON.stringify([
      { role: 'assistant', type: 'message', content: [{ type: 'text', text: '' }], tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"x"}' } }] },
      { role: 'tool', type: 'message', content: [{ type: 'text', text: 'file content' }] },
      { role: 'assistant', type: 'message', content: [{ type: 'text', text: answer }] },
    ]);
    const r = ROUTES['glm-5.3-low'].parse(withTools, dir);
    assert.equal(r.toolEvents, 2);
    assert.deepEqual([parseSeatResult({ code: 0, ...r }, loadCodes()).why, parseSeatResult({ code: 0, ...r }, loadCodes()).infra], ['tool-events', true]);
    const clean = ROUTES['mistral-large-4-low'].parse(JSON.stringify([{ role: 'assistant', type: 'message', content: [{ type: 'text', text: answer }] }]), dir);
    assert.equal(clean.toolEvents, 0);
    assert.equal(parseSeatResult({ code: 0, ...clean }, loadCodes()).failed, false);
    assert.equal(countVibeToolEvents([{ role: 'assistant', content: [{ type: 'tool_use', name: 'bash' }] }]), 1);
    assert.equal(countVibeToolEvents(null), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('B4 (final-reserve replay): a breaker stop during the final choice resumes under the same MAX_CALLS and writes the manifest', withTempHome(async (home) => {
  const repo = setup(home);
  const infraIds = SPLIT.feedback.filter((x) => x.startsWith('p')).slice(0, 4);
  let down = true;
  const override = (label, _mark, id) => (down && label === 'sol-6.1-low' && infraIds.includes(id) ? { code: 1, text: '' } : null);
  // 960 seed calls + 288 final reserve fit in 1298; the final evaluation of P0 trips (4 > 3 of 72).
  await assert.rejects(runGepa({ home, k: K, maxIterations: 0, maxCalls: 1298, seat: fakeSeat(override).seat, log: quiet }),
    /route sol-6.1-low had 4 infrastructure failures on final-P0 \(> 3 of 72\)/);
  assert.ok(!existsSync(manifestFile(repo)));
  down = false;
  const f = fakeSeat(override);
  const m = await runGepa({ home, k: K, maxIterations: 0, maxCalls: 1298, seat: f.seat, log: quiet });
  assert.ok(existsSync(manifestFile(repo)), 'the resume writes the manifest');
  assert.equal(m.result.status, 'selected');
  // Only the final calls of P0 left unanswered by the stop are paid: the rest of sol.
  assert.ok(f.seen.every((c) => c.mark === 'seed-0' && SPLIT.feedback.includes(c.id) && c.label === 'sol-6.1-low'));
  assert.ok(infraIds.every((id) => f.seen.some((c) => c.label === 'sol-6.1-low' && c.id === id)), 'the failed calls are retried');
  assert.ok(f.seen.length <= 72);
  assert.ok(m.callsSpent <= 1298);
  assert.ok(m.finalCoverage.notEvaluated > 0, 'the candidates the budget could not cover are counted');
}));

test('N1: a 429 is retried after a bounded backoff before it counts; the retries are logged paid calls', withTempHome(async (home) => {
  setup(home);
  const target = SPLIT.pareto[0];
  const attempts = new Map();
  const override = (label, mark, id) => {
    if (label !== 'glm-5.3-low') return null;
    const k = `${mark}|${id}`;
    attempts.set(k, (attempts.get(k) ?? 0) + 1);
    if (mark === 'seed-0' && id === target && attempts.get(k) <= 2) return { code: 1, text: '', stderrTail: 'HTTP 429 Too Many Requests' };
    if (mark === 'seed-2' && SPLIT.pareto.slice(0, 3).includes(id)) return { code: 2, text: '', stderrTail: 'HTTP 402 budget exhausted' };
    return null;
  };
  const sleeps = [];
  await assert.rejects(runGepa({ home, k: K, maxIterations: 0, seat: fakeSeat(override).seat, log: quiet, sleep: async (ms) => { sleeps.push(ms); } }),
    /route glm-5.3-low had 3 infrastructure failures on seed-P2 \(> 2 of 48\)/);
  // seed-0: 2 failures then an answer (cached, no breaker); seed-2: 3 cases fail all 4 attempts.
  assert.equal(attempts.get(`seed-0|${target}`), 3);
  for (const id of SPLIT.pareto.slice(0, 3)) assert.equal(attempts.get(`seed-2|${id}`), 4, 'first call + 3 retries');
  assert.deepEqual(sleeps.slice(0, 2), [30000, 120000]);
  assert.deepEqual(sleeps.slice(2).sort((a, b) => a - b), [30000, 30000, 30000, 120000, 120000, 120000, 300000, 300000, 300000]);
  const calls = readFileSync(path.join(home, 'l2', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const retried = calls.filter((c) => c.intent === true && c.attempt);
  assert.equal(retried.length, 2 + 3 * 3, 'every retry is a logged intent (counted by the run budget)');
  assert.ok(retried.every((c) => c.phase === `l4-gepa-s${K}.eval` && typeof c.backoffMs === 'number'));
  const p0 = JSON.parse(readFileSync(path.join(home, 'l4', `gepa-s${K}`, 'candidates', 'P0.json'), 'utf8'));
  assert.equal(p0.pareto[target]['glm-5.3-low'].failed, false, 'the answer after the backoff counts, not the 429');
}));

test('B5 (quota-cap replay): a quota retry never takes the budget of reserved calls; a batch filling the cap ends at callsSpent <= MAX_CALLS', withTempHome(async (home) => {
  const repo = setup(home);
  const qIds = SPLIT.feedback.slice(0, 3);
  const hit = new Set();
  const override = (label, mark, id) => {
    if (label === 'glm-5.3-low' && mark === 'seed-0' && qIds.includes(id) && !hit.has(id)) { hit.add(id); return { code: 1, text: '', stderrTail: 'HTTP 429 Too Many Requests' }; }
    return null;
  };
  // 960 seed calls + 288 for one finalist = 1248: the final batch fills the cap exactly.
  const m = await runGepa({ home, k: K, maxIterations: 0, maxCalls: 1248, quotaBackoffMs: [0, 0, 0], sleep: async () => {}, seat: fakeSeat(override).seat, log: quiet });
  assert.ok(m.callsSpent <= 1248, `callsSpent ${m.callsSpent} <= 1248`);
  assert.equal(m.callsSpent, 1248);
  assert.ok(existsSync(manifestFile(repo)));
  const calls = readFileSync(path.join(home, 'l2', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(calls.filter((c) => c.intent === true && c.attempt).length, 0, 'no retry could fit next to the reserved calls');
  assert.equal(calls.filter((c) => c.intent === false && c.quota).length, 3, 'the 3 quota failures are returned as they are');
}));

test('N6: quota detection reads stderr and the CLI error envelope only; a vibe --max-price stop is an answer failure, never retried', withTempHome(async (home) => {
  assert.ok(looksLikeQuotaFailure({ code: 1, stderrTail: 'HTTP 429 Too Many Requests' }));
  assert.ok(looksLikeQuotaFailure({ code: 1, errorEnvelope: 'insufficient_quota: You exceeded your current quota' }));
  assert.ok(!looksLikeQuotaFailure({ code: 1, text: 'the model wrote about a 429 rate limit', stdoutTail: 'quota 402' }), 'the answer and stdout are never read');
  assert.ok(!looksLikeQuotaFailure({ code: 0, stderrTail: 'HTTP 429' }));
  const maxPrice = { code: 1, stderrTail: 'Stopped: --max-price 0.50 reached (budget exhausted for this call)' };
  assert.ok(looksLikeMaxPrice(maxPrice) && !looksLikeQuotaFailure(maxPrice));
  assert.deepEqual(parseSeatResult(maxPrice, loadCodes()), { verdict: null, code: null, failed: true, why: 'max-price', infra: false });
  assert.equal(codexErrorEnvelope('{"type":"turn.failed","error":{"message":"429 Too Many Requests"}}\n{"type":"item.completed","item":{"type":"agent_message","text":"429"}}'), '429 Too Many Requests');
  // Loop: 3 max-price stops on a 48-case batch (the infra allowance is 2) — cached as answers, no retry, no breaker.
  setup(home);
  const ids = SPLIT.pareto.slice(0, 3);
  const attempts = new Map();
  const override = (label, mark, id) => {
    if (label !== 'mistral-large-4-low' || mark !== 'seed-0' || !ids.includes(id)) return null;
    attempts.set(id, (attempts.get(id) ?? 0) + 1);
    return maxPrice;
  };
  const m = await runGepa({ home, k: K, maxIterations: 0, quotaBackoffMs: [0, 0, 0], sleep: async () => { throw new Error('no backoff expected'); }, seat: fakeSeat(override).seat, log: quiet });
  assert.ok(m.result);
  assert.deepEqual([...attempts.values()], [1, 1, 1], 'never retried, never re-paid');
  const p0 = JSON.parse(readFileSync(path.join(home, 'l4', `gepa-s${K}`, 'candidates', 'P0.json'), 'utf8'));
  for (const id of ids) assert.deepEqual([p0.pareto[id]['mistral-large-4-low'].failed, p0.pareto[id]['mistral-large-4-low'].infra], [true, false]);
}));
