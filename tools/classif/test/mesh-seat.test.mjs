// llm-mesh seat route (owner 14/11): synthetic gateway only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESH_SERVED_MISMATCH, callMesh, meshUsage, servedModel } from '../lib/mesh-seat.mjs';
import { looksLikeAccountRefusal } from '../lib/account-guard.mjs';
import { parseSeatResult } from '../l4/dev.mjs';

const route = { label: 'gemini-4-argon-low', mesh: { model: 'gemini-4-argon', effort: 'low' } };
const reply = (status, json, served = 'provider=gemini; model=gemini-4-argon; transport=cloud-code') => ({
  ok: status >= 200 && status < 300, status, headers: { get: (h) => (h === 'x-sentropic-served' ? served : null) }, json: async () => json });

function gateway(answers) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/v1/session')) return reply(201, { gatewayToken: 'synthetic-bearer' });
    return answers.shift();
  };
  return { fetchImpl, seen };
}

test('mesh call: one user message, model + reasoning effort, bearer from the session, answer and usage', async () => {
  const g = gateway([reply(200, { choices: [{ message: { content: '{"verdict":"pertinent"}' } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 7 } } })]);
  const r = await callMesh(route, 'synthetic prompt', { fetchImpl: g.fetchImpl, sessionId: 't1', base: 'http://gw', sleepImpl: async () => {} });
  assert.equal(r.code, 0);
  assert.equal(r.text, '{"verdict":"pertinent"}');
  assert.deepEqual(r.usage, { input_tokens: 100, output_tokens: 20, cache_read_tokens: 40, thinking_tokens: 7, total_tokens: 120 });
  const call = g.seen.find((s) => s.url === 'http://gw/v1/chat/completions');
  assert.deepEqual(JSON.parse(call.init.body), { model: 'gemini-4-argon', reasoning: { effort: 'low' }, messages: [{ role: 'user', content: 'synthetic prompt' }] });
  assert.equal(call.init.headers.authorization, 'Bearer synthetic-bearer');
  assert.ok(!JSON.stringify(r).includes('synthetic-bearer'), 'the bearer never leaves the call');
});

test('mesh call: another served model is a failed call, never a scored answer', async () => {
  const g = gateway([reply(200, { choices: [{ message: { content: '{"verdict":"pertinent"}' } }] }, 'provider=gemini; model=gemini-3.8-flash; transport=cloud-code')]);
  const r = await callMesh(route, 'p', { fetchImpl: g.fetchImpl, sessionId: 't2', base: 'http://gw', sleepImpl: async () => {} });
  assert.equal(r.code, MESH_SERVED_MISMATCH);
  assert.equal(r.text, '');
  assert.equal(parseSeatResult(r, []).failed, true);
});

test('mesh call: 429/503 retried after the backoff delays, 403 not retried and read as an account refusal', async () => {
  const waits = [];
  const g = gateway([reply(503, { error: { message: 'overloaded' } }), reply(429, { error: { message: 'rate' } }),
    reply(200, { choices: [{ message: { content: 'ok' } }] })]);
  const r = await callMesh(route, 'p', { fetchImpl: g.fetchImpl, sessionId: 't3', base: 'http://gw', backoffMs: [5, 6, 7], sleepImpl: async (ms) => { waits.push(ms); } });
  assert.deepEqual([r.code, r.attempts, waits], [0, 3, [5, 6]]);
  const g2 = gateway([reply(503, {}), reply(503, {}), reply(503, {})]);
  const r2 = await callMesh(route, 'p', { fetchImpl: g2.fetchImpl, sessionId: 't4', base: 'http://gw', backoffMs: [1, 1], sleepImpl: async () => {} });
  assert.deepEqual([r2.code, r2.attempts], [503, 3]);
  const g3 = gateway([reply(403, { error: { message: 'permission denied' } })]);
  const r3 = await callMesh(route, 'p', { fetchImpl: g3.fetchImpl, sessionId: 't5', base: 'http://gw', sleepImpl: async () => { throw new Error('no retry'); } });
  assert.deepEqual([r3.code, r3.attempts], [403, 1]);
  assert.equal(looksLikeAccountRefusal(r3), true);
});

test('mesh helpers: served header and empty usage', () => {
  assert.equal(servedModel('provider=gemini; model=gemini-4-argon; transport=cloud-code'), 'gemini-4-argon');
  assert.equal(servedModel(null), null);
  assert.equal(meshUsage(undefined), null);
});
