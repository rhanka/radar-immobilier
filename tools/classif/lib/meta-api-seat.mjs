// Meta API route (owner 15/11): the evaluated model is called through the Meta chat completions
// API (OpenAI compatible, https://api.meta.ai/v1/chat/completions) with the owner's API key, for
// Muse Ember 1.0 low only. No CLI is spawned.
//
// Key handling: the key is read from ~/.config/radar-classif/meta-api-key at the first call of the
// process and kept IN MEMORY only. It is never written, never logged, never returned: every error
// text is redacted before it leaves this module.
//
// Protocol: POST /v1/chat/completions with one user message (the prompt), no tools, no system
// prompt, `reasoning_effort`. The answer's `model` field must be the requested model: another
// served model is a failed call, never a scored answer. 429 and 5xx are retried after the mesh
// client delays, the attempts are recorded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { testOnlyEnv } from './paths.mjs';
import { MESH_BACKOFF_MS_DEFAULT, MESH_SERVED_MISMATCH, MESH_TRANSPORT_ERROR, meshUsage } from './mesh-seat.mjs';

export const META_API_BASE_DEFAULT = 'https://api.meta.ai';
export const META_API_KEY_FILE_DEFAULT = path.join(os.homedir(), '.config', 'radar-classif', 'meta-api-key');

const inTest = (env) => env.CLASSIF_TEST_MODE === '1' || Boolean(env.NODE_TEST_CONTEXT);

/**
 * API base URL. The CLASSIF_META_API_BASE override is test-only (a fake server); in test mode
 * without it the call is refused, so no test ever reaches the real API.
 */
export function metaApiBase(env = process.env) {
  const o = testOnlyEnv(env, 'CLASSIF_META_API_BASE');
  if (o !== undefined) return o;
  if (inTest(env)) throw new Error('meta-api route refused in test mode: set a fake CLASSIF_META_API_BASE (no real call from a test)');
  return META_API_BASE_DEFAULT;
}

/** Key file: the default, or the test-only CLASSIF_META_API_KEY_FILE; refused in test mode without it. */
export function metaApiKeyFile(env = process.env) {
  const o = testOnlyEnv(env, 'CLASSIF_META_API_KEY_FILE');
  if (o !== undefined) return o;
  if (inTest(env)) throw new Error('meta-api route refused in test mode: set a fake CLASSIF_META_API_KEY_FILE (never the real key)');
  return META_API_KEY_FILE_DEFAULT;
}

/** Retry delays: the mesh default, or the test-only CLASSIF_TEST_META_BACKOFF_MS list. */
export function metaApiBackoff(env = process.env) {
  const o = testOnlyEnv(env, 'CLASSIF_TEST_META_BACKOFF_MS');
  return o === undefined ? MESH_BACKOFF_MS_DEFAULT : String(o).split(',').filter(Boolean).map(Number);
}

const keys = new Map();
/** Reads the key once per file and process; memory only. */
function apiKey(file) {
  if (!keys.has(file)) {
    let k;
    try { k = fs.readFileSync(file, 'utf8').trim(); } catch { throw new Error(`meta-api key file unreadable (${file})`); }
    if (!k) throw new Error(`meta-api key file empty (${file})`);
    keys.set(file, k);
  }
  return keys.get(file);
}

/** Removes every occurrence of the key from a text (error bodies may echo request headers). */
export function redact(text, key) {
  const s = String(text ?? '');
  return key ? s.split(key).join('<redacted>') : s;
}

/**
 * One Meta API call. Returns the callSeat shape: { code, latencyMs, timedOut, text, usage,
 * toolEvents, toolKinds, errorEnvelope, stderrTail, attempts, served }. code 0 = answered by the
 * requested model; otherwise the HTTP status, MESH_SERVED_MISMATCH or MESH_TRANSPORT_ERROR.
 */
export async function callMetaApi(route, prompt, { timeoutMs = 900000, base = metaApiBase(), keyFile = metaApiKeyFile(),
  fetchImpl = fetch, sleepImpl = sleep, backoffMs = metaApiBackoff() } = {}) {
  const started = Date.now();
  const want = route.api.model;
  const key = apiKey(keyFile);
  const body = JSON.stringify({ model: want, reasoning_effort: route.api.effort, messages: [{ role: 'user', content: prompt }] });
  let attempts = 0;
  let last = null;
  for (;;) {
    attempts++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/v1/chat/completions`, { method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body });
      const j = await res.json().catch(() => null);
      const served = typeof j?.model === 'string' ? j.model : null;
      if (res.ok) {
        const msg = j?.choices?.[0]?.message ?? {};
        const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0;
        const base0 = { latencyMs: Date.now() - started, timedOut: false, usage: meshUsage(j?.usage), attempts, served,
          toolEvents: calls, toolKinds: calls ? { tool_calls: calls } : {} };
        if (served !== want) {
          const why = `served model ${served ?? '<none>'} instead of ${want}`;
          return { ...base0, code: MESH_SERVED_MISMATCH, text: '', errorEnvelope: why, stderrTail: why };
        }
        return { ...base0, code: 0, text: typeof msg.content === 'string' ? msg.content : '', errorEnvelope: '', stderrTail: '' };
      }
      const why = redact(`HTTP ${res.status}: ${String(j?.error?.message ?? j?.message ?? '').slice(0, 300)}`, key);
      last = { code: res.status, why, served };
      if (!(res.status === 429 || res.status >= 500)) break;
    } catch (e) {
      last = { code: MESH_TRANSPORT_ERROR, why: ctl.signal.aborted ? 'timeout' : redact(String(e?.message ?? e).slice(0, 300), key), served: null, timedOut: ctl.signal.aborted };
      if (ctl.signal.aborted) break;
    } finally { clearTimeout(timer); }
    if (attempts > backoffMs.length) break;
    await sleepImpl(backoffMs[attempts - 1]);
  }
  return { code: last.code, latencyMs: Date.now() - started, timedOut: Boolean(last.timedOut), text: '', usage: null, attempts, served: last.served,
    toolEvents: 0, toolKinds: {}, errorEnvelope: last.why, stderrTail: last.why };
}
