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
import { ROUTES, countVibeToolEvents } from '../run-seat.mjs';
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
  // Every seed misses p0 on luna (no candidate, so the run can be resumed); P1 keeps 2 persistent tool events.
  const override = (label, mark, id) => {
    if (mark.startsWith('seed') && label === 'luna-6-low' && id === 'p0') return { code: 0, text: JSON.stringify({ verdict: 'non_pertinent', code: CODE.non_pertinent }) };
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
  const down = (n) => (label, mark, id) => (mark === 'seed-0' && label === 'luna-6-low' && SPLIT.pareto.slice(0, n).includes(id) ? { code: 1, text: '' } : null);
  await assert.rejects(runGepa({ home, k: K, maxIterations: 0, seat: fakeSeat(down(3)).seat, log: quiet }), /route luna-6-low had 3 infrastructure failures on seed-P0 \(> 2 of 48\)/);
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
