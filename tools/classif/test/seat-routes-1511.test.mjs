// Owner 15/11 routes: Fable 5.2 low (claude -p), Muse Ember 1.0 low (Meta API), Muse Wonder 1.0
// and Wonder Full 1.0 low (muse exec). Fake transports only: a fake spawn, a fake fetch and a
// fake key file. No real call: the routes refuse a test without a fake transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { ROUTES, SERVED_MISMATCH, callSeat, isCodexSeat, servedMatches } from '../run-seat.mjs';
import { callMetaApi, metaApiBase, metaApiKeyFile, redact } from '../lib/meta-api-seat.mjs';
import { GEPA_SERIES_ROUTES } from '../l4/gepa-common.mjs';
import { parseSeatResult } from '../l4/dev.mjs';
import { tmp } from './hermetic-helpers.mjs';

const NEW = ['fable-5.2-low', 'muse-ember-1.0-low-api', 'muse-wonder-1.0-low', 'muse-wonder-full-1.0-low'];

/** Fake spawn: records cmd/args/stdin, answers `stdout` with exit `code`. */
function fakeSpawn(stdout, code = 0) {
  const seen = {};
  const spawnImpl = (cmd, args, opts) => {
    Object.assign(seen, { cmd, args, env: opts.env, stdin: '' });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { on: () => {}, end: (d) => { seen.stdin = String(d ?? ''); setImmediate(() => { child.stdout.emit('data', stdout); child.emit('close', code); }); } };
    child.kill = () => {};
    return child;
  };
  return { spawnImpl, seen };
}

const claudeOut = (modelUsage, result = '{"verdict":"pertinent","code":"x"}') => JSON.stringify({ type: 'result', is_error: false, result, usage: { input_tokens: 5 }, total_cost_usd: 0.01, modelUsage });
const museOut = (model, text = 'OK') => [{ payload_type: 'run.model.configured', payload: { model_id: model, profile_id: 'tbh' } },
  { payload_type: 'run.terminal.completed', payload: { terminal: 'completed', text } }].map((e) => JSON.stringify(e)).join('\n');

test('new routes: registered as GEPA series routes, eval only, never codex seats', () => {
  for (const r of NEW) {
    assert.ok(ROUTES[r], r);
    assert.ok(GEPA_SERIES_ROUTES.includes(r), r);
    assert.equal(ROUTES[r].evalOnly, true, r);
    assert.equal(ROUTES[r].pauseOnUnavailable, true, r);
    assert.equal(isCodexSeat(r), false, r);
  }
  assert.equal(ROUTES['muse-wonder-full-1.0-low'].model, 'muse-wonder-full-1.0');
});

test('fable-5.2-low: claude -p on the seat, model and effort pinned, no tools, no MCP, no skills, prompt on stdin only', async () => {
  const f = fakeSpawn(claudeOut({ 'claude-fable-5-2': { inputTokens: 5 } }));
  const r = await callSeat('fable-5.2-low', 'SYNTHETIC PROMPT', { spawnImpl: f.spawnImpl });
  assert.equal(f.seen.cmd, 'claude');
  const a = f.seen.args;
  assert.equal(a[a.indexOf('--model') + 1], 'claude-fable-5-2');
  assert.equal(a[a.indexOf('--effort') + 1], 'low');
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.ok(a.includes('--disable-slash-commands') && a.includes('--strict-mcp-config') && a.includes('--no-session-persistence'));
  assert.ok(!a.some((x) => x.includes('SYNTHETIC PROMPT')), 'prompt never in argv');
  assert.equal(f.seen.stdin, 'SYNTHETIC PROMPT');
  assert.ok(!Object.keys(f.seen.env).some((k) => /^ANTHROPIC_/.test(k)), 'no Anthropic key reaches the seat');
  assert.equal(r.code, 0);
  assert.deepEqual(r.served, ['claude-fable-5-2']);
  assert.equal(r.text, '{"verdict":"pertinent","code":"x"}');
});

test('fable-5.2-low: an answer of another model is a failed call (98), never scored', async () => {
  const f = fakeSpawn(claudeOut({ 'claude-opus-5-5': {} }));
  const r = await callSeat('fable-5.2-low', 'p', { spawnImpl: f.spawnImpl });
  assert.equal(r.code, SERVED_MISMATCH);
  assert.equal(r.text, '');
  assert.equal(parseSeatResult(r, new Map()).failed, true);
  const none = await callSeat('fable-5.2-low', 'p', { spawnImpl: fakeSpawn('not json').spawnImpl });
  assert.notEqual(none.code, 0);
});

test('muse wonder routes: muse exec low, contributor mode off, served model checked', async () => {
  for (const [label, model] of [['muse-wonder-1.0-low', 'muse-wonder-1.0'], ['muse-wonder-full-1.0-low', 'muse-wonder-full-1.0']]) {
    const f = fakeSpawn(museOut(model));
    const r = await callSeat(label, 'p', { spawnImpl: f.spawnImpl });
    const a = f.seen.args;
    assert.equal(f.seen.cmd, 'muse');
    assert.equal(a[a.indexOf('--model') + 1], model);
    assert.equal(a[a.indexOf('--reasoning-effort') + 1], 'low');
    assert.equal(a[a.indexOf('--contributor-mode') + 1], 'off');
    assert.deepEqual([r.code, r.served, r.text], [0, model, 'OK'], label);
    const bad = await callSeat(label, 'p', { spawnImpl: fakeSpawn(museOut(`${model}-contributor`)).spawnImpl });
    assert.equal(bad.code, SERVED_MISMATCH, label);
  }
});

test('served-checked CLI routes refuse the real spawn in test mode', () => {
  assert.throws(() => callSeat('fable-5.2-low', 'p'), /refused in test mode/);
  assert.throws(() => callSeat('muse-wonder-full-1.0-low', 'p'), /refused in test mode/);
});

test('servedMatches: exact id or context/date suffix only', () => {
  assert.equal(servedMatches(['claude-fable-5-2'], 'claude-fable-5-2'), true);
  assert.equal(servedMatches(['claude-fable-5-2[1m]'], 'claude-fable-5-2'), true);
  assert.equal(servedMatches('muse-wonder-1.0', 'muse-wonder-1.0'), true);
  assert.equal(servedMatches('muse-wonder-1.0-contributor', 'muse-wonder-1.0'), false);
  assert.equal(servedMatches([], 'claude-fable-5-2'), false);
  assert.equal(servedMatches(null, 'x'), false);
});

// ---- Meta API (Ember low) ----
const KEY = 'synthetic-meta-key-0000';
function keyFile() {
  const d = tmp('meta-key-');
  const f = path.join(d, 'meta-api-key');
  fs.writeFileSync(f, `${KEY}\n`, { mode: 0o600 });
  return f;
}
const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const route = { label: 'muse-ember-1.0-low-api', ...ROUTES['muse-ember-1.0-low-api'] };

test('meta api: one user message, model and reasoning_effort, bearer from the key file, key never returned', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return reply(200, { model: 'muse-ember-1.0', choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 } }); };
  const r = await callMetaApi(route, 'synthetic prompt', { base: 'http://fake', keyFile: keyFile(), fetchImpl, sleepImpl: async () => {} });
  assert.deepEqual([r.code, r.text, r.served, r.attempts], [0, 'OK', 'muse-ember-1.0', 1]);
  assert.equal(seen[0].url, 'http://fake/v1/chat/completions');
  assert.deepEqual(JSON.parse(seen[0].init.body), { model: 'muse-ember-1.0', reasoning_effort: 'low', messages: [{ role: 'user', content: 'synthetic prompt' }] });
  assert.equal(seen[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('meta api: other served model = 98; 429/5xx retried with the backoff; 400 not retried; errors redacted', async () => {
  const kf = keyFile();
  const mism = await callMetaApi(route, 'p', { base: 'http://fake', keyFile: kf, fetchImpl: async () => reply(200, { model: 'muse-spark-1.3', choices: [{ message: { content: 'OK' } }] }), sleepImpl: async () => {} });
  assert.deepEqual([mism.code, mism.text], [SERVED_MISMATCH, '']);
  const answers = [reply(429, {}), reply(503, {}), reply(200, { model: 'muse-ember-1.0', choices: [{ message: { content: 'OK' } }] })];
  const waits = [];
  const ok = await callMetaApi(route, 'p', { base: 'http://fake', keyFile: kf, fetchImpl: async () => answers.shift(), backoffMs: [5, 6, 7], sleepImpl: async (ms) => { waits.push(ms); } });
  assert.deepEqual([ok.code, ok.attempts, waits], [0, 3, [5, 6]]);
  const bad = await callMetaApi(route, 'p', { base: 'http://fake', keyFile: kf, fetchImpl: async () => reply(400, { error: { message: `bad header Bearer ${KEY}` } }), sleepImpl: async () => { throw new Error('no retry'); } });
  assert.deepEqual([bad.code, bad.attempts], [400, 1]);
  assert.ok(!JSON.stringify(bad).includes(KEY));
  assert.equal(redact(`a ${KEY} b`, KEY), 'a <redacted> b');
});

test('meta api: refused in test mode without a fake server or a fake key file (no real call, never the real key)', async () => {
  assert.throws(() => metaApiBase({ CLASSIF_TEST_MODE: '1' }), /refused in test mode/);
  assert.throws(() => metaApiKeyFile({ CLASSIF_TEST_MODE: '1' }), /refused in test mode/);
  assert.throws(() => metaApiBase({ CLASSIF_META_API_BASE: 'http://x' }), /test-only/);
  await assert.rejects(callSeat('muse-ember-1.0-low-api', 'p'), /refused in test mode/);
});

test('a seat usage limit (claude CLI « hit your Fable limit ») pauses the blind, never a scored failure', async () => {
  const { seatUnavailable } = await import('../lib/mesh-seat.mjs');
  const msg = "You've hit your Fable limit · resets Nov 22, 9am (America/Toronto).";
  const f = fakeSpawn(JSON.stringify({ type: 'result', is_error: true, result: msg, usage: {}, modelUsage: {} }), 1);
  const r = await callSeat('fable-5.2-low', 'p', { spawnImpl: f.spawnImpl });
  assert.equal(r.code, 1);
  assert.equal(seatUnavailable(r), true);
  assert.equal(seatUnavailable({ code: 1, stderrTail: '', errorEnvelope: 'invalid json answer' }), false);
});
