// ChatGPT quota guard of the codex seats (shared with the production immo detection): rate_limits
// extraction from the codex --json stream, pause at CODEX_QUOTA_PAUSE (85 by default) or on a
// reached rate limit, resume without repaying, quota status. Hermetic, fake codex outputs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runGepa } from '../l4/gepa.mjs';
import { GEPA_ROUTES } from '../l4/gepa-common.mjs';
import { countCodexToolEvents, parseCodex } from '../run-seat.mjs';
import { CodexQuotaPause, extractCodexRateLimits, parseQuotaPause, quotaStatus } from '../lib/codex-quota.mjs';
import { formatQuotaStatus } from '../quota-status.mjs';
import { buildFingerprints } from '../lib/fingerprint.mjs';
import { initTempRepo, withTempHome, writeRepoFile } from './hermetic-helpers.mjs';

const K = '9';
const RULES = 'Classify each municipal regulatory item by the registry code that best describes its densification effect. '
  + 'Return one JSON object per item with verdict, code, ambiguous and citation. The verdict is the registry partition of the code. ';
const CODE = { pertinent: 'P-DENSITE', non_pertinent: 'N-ADMIN' };
const TUNING = [...Array.from({ length: 10 }, (_, i) => ({ itemId: `p${i}`, verdict: 'pertinent' })),
  ...Array.from({ length: 20 }, (_, i) => ({ itemId: `n${i}`, verdict: 'non_pertinent' }))].map((r) => ({ ...r, code: CODE[r.verdict] }));
const REF = new Map(TUNING.map((r) => [r.itemId, r.verdict]));
const RESETS = 1794440618;
const RESETS_ISO = new Date(RESETS * 1000).toISOString();
const quiet = () => {};
const rl = (used, reached = null) => ({ primary: { used_percent: used, window_minutes: 10080, resets_at: RESETS }, plan_type: 'pro', rate_limit_reached_type: reached });

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

/** Fake seats; codex seats (sol, astra) report `quota(label)` as their rate_limits. */
function fakeSeat(quota = () => rl(40)) {
  const seen = [];
  const seat = async (label, prompt) => {
    seen.push({ label, prompt });
    const rateLimits = ['sol-6.1-low', 'astra-max'].includes(label) ? quota(label) : undefined;
    if (!GEPA_ROUTES.includes(label)) return { code: 0, text: `${RULES}MARK:child-${seen.length}`, latencyMs: 1, rateLimits };
    const id = /### item_id: (\S+)/.exec(prompt)[1];
    // Seeds miss every P case on mistral: every iteration has an error to reflect on.
    const v = /MARK:seed/.test(prompt) && label === 'mistral-large-4-low' && REF.get(id) === 'pertinent' ? 'non_pertinent' : REF.get(id);
    return { code: 0, text: JSON.stringify({ verdict: v, code: CODE[v] }), latencyMs: 1, rateLimits };
  };
  return { seat, seen, codex: () => seen.filter((s) => ['sol-6.1-low', 'astra-max'].includes(s.label)) };
}
const calls = (home) => readFileSync(path.join(home, 'l2', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('quota: rate_limits extracted from the codex --json stream (token_count), never a tool event', () => {
  const stream = [
    { type: 'thread.started' },
    { type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: 69, window_minutes: 10080, resets_at: RESETS }, secondary: null, plan_type: 'pro', rate_limit_reached_type: null } } },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"verdict":"pertinent"}' } },
    { type: 'token_count', rate_limits: { primary: { used_percent: 71, window_minutes: 10080, resets_at: RESETS }, plan_type: 'pro', rate_limit_reached_type: null } },
    { type: 'turn.completed', usage: { input_tokens: 3 } },
  ].map((e) => JSON.stringify(e)).join('\n');
  assert.deepEqual(extractCodexRateLimits(stream), rl(71), 'the last measurement wins, normalised');
  assert.equal(extractCodexRateLimits('{"type":"turn.completed"}'), null);
  assert.equal(countCodexToolEvents(stream).toolEvents, 0, 'quota metering is benign');
  assert.equal(countCodexToolEvents('{"type":"surprise"}').toolEvents, 1, 'any other unknown type still fails closed');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quota-parse-'));
  try { assert.deepEqual(parseCodex(stream, dir).rateLimits, rl(71)); } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(parseQuotaPause(undefined), 85);
  assert.equal(parseQuotaPause('70'), 70);
  assert.throws(() => parseQuotaPause('0'), /percentage/);
  assert.throws(() => parseQuotaPause('120'), /percentage/);
});

test('quota: a codex call at 85 % stops GEPA (no further codex call), the message gives percent, reset UTC and resume; the resume repays nothing', withTempHome(async (home) => {
  setup(home);
  const f = fakeSeat(() => rl(86));
  await assert.rejects(runGepa({ home, k: K, maxIterations: 0, seat: f.seat, log: quiet }), (e) => {
    assert.ok(e instanceof CodexQuotaPause);
    assert.match(e.message, /sol-6\.1-low reports 86% of the weekly ChatGPT quota used \(>= 85%\)/);
    assert.ok(e.message.includes(`quota resets at ${RESETS_ISO} (UTC)`));
    assert.ok(e.message.includes(`\`make classif-l4-gepa SERIES=${K} MAX_CALLS=5000 RUN=s${K} SEED='gepa-s${K}' MAX_ITER=0 ENV=preprod\``));
    return true;
  });
  assert.ok(f.codex().length <= 2, 'only the codex calls already in flight were launched');
  const logged = calls(home).filter((c) => c.intent === false && c.route === 'sol-6.1-low');
  assert.ok(logged.length > 0 && logged.every((c) => c.quotaUsedPercent === 86 && c.quotaResetsAt === RESETS_ISO), 'quota logged per codex call');
  assert.ok(calls(home).filter((c) => c.intent === false && c.route === 'opus-5.5-low').every((c) => !('quotaUsedPercent' in c)));
  // Resume once the quota is back: no answered call is paid again.
  const answered = new Set(f.seen.map((s) => `${s.label}|${s.prompt}`));
  const g = fakeSeat(() => rl(40));
  const m = await runGepa({ home, k: K, maxIterations: 0, seat: g.seat, log: quiet });
  assert.ok(m.result);
  assert.ok(!g.seen.some((s) => answered.has(`${s.label}|${s.prompt}`)), 'an answered call was repaid');
}));

test('quota: the threshold is configurable; a reached rate limit stops whatever the percentage', withTempHome(async (home) => {
  setup(home);
  const m = await runGepa({ home, k: K, maxIterations: 0, codexQuotaPause: 90, seat: fakeSeat(() => rl(86)).seat, log: quiet });
  assert.ok(m.result, '86 % < 90 %: no pause');
  const home2 = mkdtempSync(path.join(os.tmpdir(), 'quota-home-'));
  try {
    setup(home2);
    await assert.rejects(runGepa({ home: home2, k: K, maxIterations: 0, codexQuotaPause: 90, seat: fakeSeat(() => rl(12, 'primary')).seat, log: quiet }),
      (e) => e instanceof CodexQuotaPause && /rate_limit_reached_type=primary at 12%/.test(e.message) && /CODEX_QUOTA_PAUSE=90 ENV=preprod`/.test(e.message));
  } finally { rmSync(home2, { recursive: true, force: true }); }
}));

test('quota: the astra mutator reaching the threshold stops the loop; its answer is cached and the resume does not repay it', withTempHome(async (home) => {
  setup(home);
  const f = fakeSeat((label) => rl(label === 'astra-max' ? 88 : 30));
  await assert.rejects(runGepa({ home, k: K, maxIterations: 1, seat: f.seat, log: quiet }), (e) => e instanceof CodexQuotaPause && /astra-max reports 88%/.test(e.message));
  const astra = f.seen.filter((s) => s.label === 'astra-max');
  assert.equal(astra.length, 1);
  const g = fakeSeat(() => rl(30));
  await runGepa({ home, k: K, maxIterations: 1, seat: g.seat, log: quiet });
  assert.ok(!g.seen.some((s) => s.label === 'astra-max' && s.prompt === astra[0].prompt), 'the mutation is replayed from its cache');
}));

test('quota status: last measurement per codex seat from calls.jsonl, unknown when none', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quota-status-'));
  try {
    const log = path.join(dir, 'calls.jsonl');
    writeFileSync(log, [
      { at: '2026-11-06T10:00:00.000Z', intent: false, route: 'sol-6.1-low', quotaUsedPercent: 70, quotaResetsAt: RESETS_ISO },
      { at: '2026-11-06T11:00:00.000Z', intent: false, route: 'sol-6.1-low', quotaUsedPercent: 72, quotaResetsAt: RESETS_ISO },
      { at: '2026-11-06T09:00:00.000Z', intent: false, annotator: 'astra-max', quotaUsedPercent: 90, quotaResetsAt: RESETS_ISO },
      { at: '2026-11-06T12:00:00.000Z', intent: false, route: 'opus-5.5-low' },
    ].map((r) => JSON.stringify(r)).join('\n'));
    const now = Date.parse('2026-11-06T12:00:00.000Z');
    const s = quotaStatus(log, { seats: ['astra-max', 'sol-6.1-low', 'luna-6-low'], now });
    assert.deepEqual(s['sol-6.1-low'], { usedPercent: 72, resetsAt: RESETS_ISO, reachedType: null, at: '2026-11-06T11:00:00.000Z', ageMinutes: 60 });
    assert.equal(s['luna-6-low'], null);
    const text = formatQuotaStatus(s, 85);
    assert.match(text, /sol-6\.1-low: 72 % used, resets at .* \(UTC\), measured 60 min ago/);
    assert.match(text, /astra-max: 90 % used.* — PAUSED/);
    assert.match(text, /luna-6-low: unknown/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
