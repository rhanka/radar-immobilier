// L4 optimise bounded REPAIR pass: hermetic. The paid seat is a fake injected into main();
// the shingle firewall is the REAL assertNoVerbatim over a mock sealed set (synthetic text,
// salted fingerprints in a temp CLASSIF_HOME). Temp repo via CLASSIF_REPO in test mode, so
// P<k+1>.md and the optimise manifest never land in the real checkout. No paid call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_REPAIRS, REPAIR_INSTRUCTION, buildRepairPrompt, main } from '../l4/optimise.mjs';
import { buildFingerprints, scanText } from '../lib/fingerprint.mjs';
import { BUDGET_CAP, spent, spentByPhase } from '../lib/budget.mjs';
import { initTempRepo, withTempHome, writeRepoFile } from './hermetic-helpers.mjs';
import process from 'node:process';

const K = '7';
const SALT = 'repair-salt';
// Mock sealed set: two synthetic inputs. The dirty candidates copy SEALED_A only.
const SEALED_A = 'the fictional quarry hamlet council adopted bylaw changes allowing triplex dwellings beside the northern orchard lane today';
const SEALED_B = 'an imaginary lakeside borough rejected every request to convert its heritage granary into rental apartments last winter season';
const RULES = 'Classify each municipal regulatory item by the registry code that best describes its densification effect. '
  + 'Return one JSON object per item with verdict, code, ambiguous and citation. The verdict is the registry partition of the code. ';
const CLEAN1 = `${RULES}Prefer the most specific code when several apply.`;
const CLEAN2 = `${RULES}When a change only renames a zone without altering permitted uses, answer the non pertinent code.`;
const DIRTY = (n) => `${RULES}Rule ${n}: a typical case reads as follows: ${SEALED_A}.`;
const OPT = 'You improve';
const REC = 'You fuse';

function setup(home) {
  const repo = initTempRepo();
  process.env.CLASSIF_REPO = repo;
  writeRepoFile(repo, `tools/classif/l4/prompts/P${K}.md`, `${RULES}\n`);
  writeRepoFile(repo, `tools/classif/l4/manifests/series-${K}-dev.json`, JSON.stringify({ routes: ['r1'], aggregates: { r1: { recall: 0.5 } } }));
  const put = (rel, body) => { mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); writeFileSync(path.join(home, rel), body); };
  put('l3b/reference-d.jsonl', `${JSON.stringify({ itemId: 'it-1', half: 'tuning', status: 'resolved', code: 'P-X', verdict: 'pertinent' })}\n`);
  put(`l4/series-${K}/dev-r1.jsonl`, `${JSON.stringify({ itemId: 'it-1', ref: 'P-X', refVerdict: 'pertinent', pred: { code: 'P-X', verdict: 'pertinent' } })}\n`);
  put(`l4/series-${K}/errors.json`, '{}');
  put('guard/salt', `${SALT}\n`);
  put('guard/fingerprints.json', JSON.stringify(buildFingerprints(SALT, { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: [SEALED_A, SEALED_B] })));
  return repo;
}

/** Fake seat: proposals and reconciliation from fixed texts, repairs from a queue (null = seat crash). */
function fakeSeat({ reconcile = DIRTY(0), repairs = [], refuse = [] } = {}) {
  const seen = [];
  const seat = async (annotator, prompt) => {
    seen.push({ annotator, prompt });
    if (refuse.some((p) => prompt.startsWith(p))) throw new Error(`fake seat: unexpected paid call (${prompt.slice(0, 12)})`);
    if (prompt.startsWith(OPT)) return { code: 0, text: CLEAN1, latencyMs: 1 };
    if (prompt.startsWith(REC)) return { code: 0, text: reconcile, latencyMs: 1 };
    assert.ok(prompt.startsWith(REPAIR_INSTRUCTION), 'unknown prompt kind');
    const next = repairs.shift();
    return next === null || next === undefined ? { code: 1, text: '', latencyMs: 1 } : { code: 0, text: next, latencyMs: 1 };
  };
  return { seat, seen, repairPrompts: () => seen.filter((s) => s.prompt.startsWith(REPAIR_INSTRUCTION)) };
}

const calls = (home) => readFileSync(path.join(home, 'l2', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const outPrompt = (repo) => path.join(repo, 'tools', 'classif', 'l4', 'prompts', `P${Number(K) + 1}.md`);
const manifestFile = (repo) => path.join(repo, 'tools', 'classif', 'l4', 'manifests', `series-${K}-optimise.json`);

test('repair: a refused fused prompt is repaired on the 1st repair and frozen', withTempHome(async (home) => {
  const repo = setup(home);
  const f = fakeSeat({ repairs: [CLEAN2] });
  const m = await main(['--series', K], { seat: f.seat });
  assert.equal(m.repairs, 1);
  assert.match(m.shingleCheck, /^pass/);
  assert.equal(readFileSync(outPrompt(repo), 'utf8'), `${CLEAN2}\n`);
  assert.equal(JSON.parse(readFileSync(manifestFile(repo), 'utf8')).repairs, 1);
  assert.equal(f.seen.length, 4);
  const rp = f.repairPrompts();
  assert.equal(rp.length, 1);
  assert.equal(rp[0].annotator, 'muse-wonder-max');
  const repairLog = calls(home).filter((r) => r.phase === `l4-opt-s${K}-repair1`);
  assert.deepEqual(repairLog.map((r) => r.intent), [true, false]);
  assert.ok(!calls(home).some((r) => r.phase === `l4-opt-s${K}-repair2`));
}));

test('repair: still refused after 2 repairs throws (fail closed), nothing frozen', withTempHome(async (home) => {
  const repo = setup(home);
  const f = fakeSeat({ repairs: [DIRTY(1), DIRTY(2), CLEAN2] });
  await assert.rejects(main(['--series', K], { seat: f.seat }), /freeze refused: prompt P8 after 2 repair\(s\) carries \d+ verbatim/);
  assert.equal(f.repairPrompts().length, MAX_REPAIRS);
  // Each repair rewrites the latest candidate.
  assert.equal(f.repairPrompts()[1].prompt, buildRepairPrompt(DIRTY(1)));
  assert.ok(!existsSync(outPrompt(repo)));
  assert.ok(!existsSync(manifestFile(repo)));
}));

test('repair: the repair prompt carries no shingle hint and no sealed text beyond the model candidate', withTempHome(async (home) => {
  setup(home);
  const f = fakeSeat({ repairs: [DIRTY(1), CLEAN2] });
  const m = await main(['--series', K], { seat: f.seat });
  assert.equal(m.repairs, 2);
  // The builder's single input is the candidate: no channel for a shingle, a hit or sealed text.
  assert.equal(buildRepairPrompt.length, 1);
  const candidates = [DIRTY(0), DIRTY(1)];
  f.repairPrompts().forEach(({ prompt }, i) => {
    assert.equal(prompt, buildRepairPrompt(candidates[i]));
    // Everything but the model's own candidate: zero sealed shingles, no sealed phrase, no hit detail.
    const frame = prompt.replace(candidates[i].trim(), '');
    assert.equal(scanText(SALT, JSON.parse(readFileSync(path.join(home, 'guard', 'fingerprints.json'), 'utf8')), frame).shingles, 0);
    for (const sealed of [SEALED_A, SEALED_B]) {
      const w = sealed.split(' ');
      for (let j = 0; j + 4 <= w.length; j++) assert.ok(!frame.includes(w.slice(j, j + 4).join(' ')), 'sealed phrase in repair frame');
    }
    assert.ok(!prompt.includes(SEALED_B), 'sealed text absent from the candidate must never be sent');
    assert.ok(!prompt.includes(SALT));
    assert.ok(!/shingle|sealed|fingerprint/i.test(frame));
  });
}));

test('repair: the budget plans and logs the repair calls', withTempHome(async (home) => {
  setup(home);
  // Up front: 2 proposals + 1 reconciliation + MAX_REPAIRS; 4 remaining refuses before any call.
  mkdirSync(path.join(home, 'l2'), { recursive: true });
  const filler = `${JSON.stringify({ intent: true, phase: 'filler' })}\n`.repeat(BUDGET_CAP - 4);
  writeFileSync(path.join(home, 'l2', 'calls.jsonl'), filler);
  const blocked = fakeSeat({ repairs: [CLEAN2] });
  await assert.rejects(main(['--series', K], { seat: blocked.seat }), /pilot budget refused: \d+ calls spent \+ 5 planned/);
  assert.equal(blocked.seen.length, 0);
  // With room, every repair call is an intent record counted by spent().
  writeFileSync(path.join(home, 'l2', 'calls.jsonl'), '');
  const f = fakeSeat({ repairs: [DIRTY(1), CLEAN2] });
  await main(['--series', K], { seat: f.seat });
  const by = spentByPhase(home);
  assert.equal(by[`l4-opt-s${K}-repair1`], 1);
  assert.equal(by[`l4-opt-s${K}-repair2`], 1);
  assert.equal(spent(home), 5);
}));

test('repair: a re-run reuses the cached proposals and reconciliation, only the repair is paid', withTempHome(async (home) => {
  const repo = setup(home);
  // Run 1: proposals + reconciliation returned, the repair seat crashes.
  const first = fakeSeat({ repairs: [null] });
  await assert.rejects(main(['--series', K], { seat: first.seat }), /seat exit 1/);
  assert.equal(first.seen.length, 4);
  // Run 2: any optimiser or reconciliation call would be a new spend — refused by the fake.
  const second = fakeSeat({ repairs: [CLEAN2], refuse: [OPT, REC] });
  const m = await main(['--series', K], { seat: second.seat });
  assert.equal(m.repairs, 1);
  assert.equal(second.seen.length, 1);
  assert.equal(readFileSync(outPrompt(repo), 'utf8'), `${CLEAN2}\n`);
  const intents = calls(home).filter((r) => r.intent);
  assert.equal(intents.filter((r) => r.phase === `l4-opt-s${K}`).length, 2);
  assert.equal(intents.filter((r) => r.phase === `l4-opt-s${K}-reconcile`).length, 1);
  assert.equal(intents.filter((r) => r.phase === `l4-opt-s${K}-repair1`).length, 2);
  assert.ok(readdirSync(path.join(home, 'l4', 'opt-raw')).some((n) => n.startsWith(`l4-opt-s${K}-repair1.muse-wonder-max.`)));
}));
