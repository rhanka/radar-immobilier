// ChatGPT quota guard of the codex seats (shared with the production immo detection): rate_limits
// extraction from the codex --json stream, pause at CODEX_QUOTA_PAUSE (85 by default) or on a
// reached rate limit, resume without repaying, quota status. Hermetic, fake codex outputs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runGepa } from '../l4/gepa.mjs';
import { GEPA_ROUTES } from '../l4/gepa-common.mjs';
import { callSeat, codexHomeDir, countCodexToolEvents, parseCodex } from '../run-seat.mjs';
import { parseSeatResult } from '../l4/dev.mjs';
import { loadCodes } from '../l2/run.mjs';
import { CodexQuotaPause, extractCodexRateLimits, parseQuotaPause, quotaFields, quotaStatus } from '../lib/codex-quota.mjs';
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
    // Seeds miss every P case on opus: every iteration has an error to reflect on.
    const v = /MARK:seed/.test(prompt) && label === 'opus-5.5-low' && REF.get(id) === 'pertinent' ? 'non_pertinent' : REF.get(id);
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

// ---- session file source (real codex: rate_limits only in $CODEX_HOME/sessions/.../rollout-*.jsonl)

// Exact notice captured from a real codex-cli 0.163.0 call (2026-11-07).
const CODE_MODE = 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';

test('quota: the "Code Mode is unavailable" error item is benign (no tool event, the call is accepted); other error items still count', () => {
  const stream = [
    { type: 'thread.started', thread_id: 't-1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'error', message: CODE_MODE } },
    { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: '{"verdict":"pertinent","code":"P-DENSITE"}' } },
    { type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2 } },
  ].map((e) => JSON.stringify(e)).join('\n');
  assert.equal(countCodexToolEvents(stream).toolEvents, 0);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codemode-'));
  try {
    const r = parseCodex(stream, dir);
    assert.equal(r.toolEvents, 0);
    assert.deepEqual(parseSeatResult({ code: 0, ...r }, loadCodes()), { verdict: 'pertinent', code: 'P-DENSITE', failed: false, why: null, infra: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(countCodexToolEvents(JSON.stringify({ type: 'item.completed', item: { type: 'error', message: 'tool call failed: cat' } })).toolEvents, 1);
});

/** Fake codex (node): writes a realistic session file (prompt + token_count) unless FAKE_NO_SESSION, then answers. */
const FAKE_CODEX = `
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2); const out = args[args.indexOf('-o') + 1];
let input = ''; process.stdin.on('data', (d) => { input += d; }).on('end', () => {
  const tid = process.env.FAKE_NO_THREAD ? null : '01a1b366-fbf9-7503-896f-' + String(Date.now()).slice(-12);
  const dir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '11', '06');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-2026-11-06T19-27-13-' + (tid ?? 'nothread') + '.jsonl');
  fs.writeFileSync(file, [
    { type: 'session_meta', payload: { id: tid, instructions: null } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] } },
    { type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { limit_id: 'codex', limit_name: null,
      primary: { used_percent: Number(process.env.FAKE_USED ?? 86), window_minutes: 10080, resets_at: 1794440618 }, secondary: null,
      credits: { has_credits: false, unlimited: false, balance: '0' }, plan_type: 'pro', rate_limit_reached_type: null } } },
  ].map((e) => JSON.stringify(e)).join('\\n') + '\\n');
  if (tid) process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: ${JSON.stringify(CODE_MODE)} } }) + '\\n');
  if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
  const id = (/### item_id: (\\S+)/.exec(input) ?? [])[1] ?? 'x';
  fs.writeFileSync(out, JSON.stringify({ verdict: id.startsWith('n') ? 'non_pertinent' : 'pertinent', code: id.startsWith('n') ? 'N-ADMIN' : 'P-DENSITE' }));
  process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3 } }) + '\\n');
});`;

function fakeCodexSpawn(home, env = {}) {
  const script = path.join(home, 'fake-codex.cjs');
  writeFileSync(script, FAKE_CODEX);
  return (_cmd, args, o) => spawn(process.execPath, [script, ...args], { ...o, env: { ...o.env, ...env } });
}
const sessionFiles = (codexHome) => {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p); } };
  try { walk(path.join(codexHome, 'sessions')); } catch { /* none */ }
  return out;
};
const sessionDirs = (codexHome) => { try { return readdirSync(path.join(codexHome, 'sessions')); } catch { return []; } };

test('quota: callSeat reads rate_limits from the session file of the call, then no session file stays (success, failure, no thread id)', withTempHome(async (home) => {
  const codexHome = codexHomeDir('sol-6.1-low');
  const ok = await callSeat('sol-6.1-low', 'prompt secret\n### item_id: p1\n', { spawnImpl: fakeCodexSpawn(home, { FAKE_USED: '86' }) });
  assert.equal(ok.code, 0);
  assert.equal(ok.toolEvents, 0, 'the Code Mode notice is no tool event');
  assert.deepEqual(ok.rateLimits, { primary: { used_percent: 86, window_minutes: 10080, resets_at: 1794440618 }, plan_type: 'pro', rate_limit_reached_type: null });
  assert.deepEqual(quotaFields(ok), { quotaUsedPercent: 86, quotaResetsAt: new Date(1794440618 * 1000).toISOString() });
  assert.deepEqual(sessionFiles(codexHome), [], 'session file deleted after a success');
  assert.deepEqual(sessionDirs(codexHome), [], 'empty date directories removed');
  const bad = await callSeat('sol-6.1-low', 'prompt secret', { spawnImpl: fakeCodexSpawn(home, { FAKE_EXIT: '1' }) });
  assert.equal(bad.code, 1);
  assert.equal(bad.rateLimits.primary.used_percent, 86, 'the quota is read even from a failed call');
  assert.deepEqual(sessionFiles(codexHome), [], 'session file deleted after a failure');
  const noThread = await callSeat('sol-6.1-low', 'prompt secret', { spawnImpl: fakeCodexSpawn(home, { FAKE_NO_THREAD: '1' }) });
  assert.equal(noThread.rateLimits.primary.used_percent, 86);
  assert.deepEqual(sessionFiles(codexHome), [], 'without a thread id the files of the call are found by snapshot and deleted');
}));

test('quota: integration — a realistic session file at 86 % trips the guard through the real callSeat, and the file is deleted', withTempHome(async (home) => {
  setup(home);
  const spawnImpl = fakeCodexSpawn(home, { FAKE_USED: '86' });
  const fallback = fakeSeat(() => undefined);
  const seat = (label, prompt, opts) => (label === 'sol-6.1-low' ? callSeat(label, prompt, { ...opts, spawnImpl }) : fallback.seat(label, prompt));
  await assert.rejects(runGepa({ home, k: K, maxIterations: 0, seat, log: quiet }),
    (e) => e instanceof CodexQuotaPause && /sol-6\.1-low reports 86% of the weekly ChatGPT quota used/.test(e.message));
  assert.deepEqual(sessionFiles(codexHomeDir('sol-6.1-low')), [], 'no session file (prompt text) left on disk');
  const logged = calls(home).filter((c) => c.intent === false && c.route === 'sol-6.1-low');
  assert.ok(logged.length >= 1 && logged.every((c) => c.quotaUsedPercent === 86 && c.toolEvents === 0 && c.exitCode === 0));
}));
