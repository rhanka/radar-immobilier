// llm-mesh seat route (owner 14/11): the evaluated model is called through the local llm-mesh
// gateway (h2a gateway host, 127.0.0.1:3002), on an ENROLLED seat account, the same mesh path the
// immo refresh uses in preprod and prod (provider adapter + cloud-code transport, model id plus
// reasoning effort). No CLI is spawned and no agy route is used.
//
// Protocol: POST /v1/session {sessionId} mints a bearer kept IN MEMORY only (never written, never
// logged); POST /v1/chat/completions with one user message (the prompt, as the agy route sent
// it), no tools, no system prompt, `reasoning: {effort}`. The gateway maps model + effort to the
// wire id (cloud-code: `<model>-<effort>` when the account catalogue has it, thinkingLevel set).
// Every answer must carry `x-sentropic-served: ... model=<model>`: a different served model (an
// alias or a sticky affinity) is a failed call, never a scored answer. 429 and 5xx are retried
// after a delay (owner: delay between calls on 429), the attempts are recorded.
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { testOnlyEnv } from './paths.mjs';

export const MESH_GATEWAY_DEFAULT = 'http://127.0.0.1:3002';
export const MESH_BACKOFF_MS_DEFAULT = [30000, 120000, 300000];
/** Synthetic exit code of an answer served by another model than the requested one. */
export const MESH_SERVED_MISMATCH = 98;
/** Synthetic exit code of a transport error (no HTTP answer) or a timeout. */
export const MESH_TRANSPORT_ERROR = 99;

/**
 * Gateway base URL. The CLASSIF_MESH_GATEWAY override is test-only (a fake gateway); in test mode
 * without it the call is refused, so no test ever reaches the real gateway.
 */
export function meshGateway(env = process.env) {
  const o = testOnlyEnv(env, 'CLASSIF_MESH_GATEWAY');
  if (o !== undefined) return o;
  if (env.CLASSIF_TEST_MODE === '1' || env.NODE_TEST_CONTEXT) throw new Error('llm-mesh route refused in test mode: set a fake CLASSIF_MESH_GATEWAY (no real call from a test)');
  return MESH_GATEWAY_DEFAULT;
}

/** Retry delays: the default, or the test-only CLASSIF_TEST_MESH_BACKOFF_MS list (comma separated). */
export function meshBackoff(env = process.env) {
  const o = testOnlyEnv(env, 'CLASSIF_TEST_MESH_BACKOFF_MS');
  return o === undefined ? MESH_BACKOFF_MS_DEFAULT : String(o).split(',').filter(Boolean).map(Number);
}

/** Served model from the `x-sentropic-served` header (`provider=..; model=..; transport=..`). */
export function servedModel(header) {
  const m = /(?:^|;)\s*model=([^;\s]+)/.exec(String(header ?? ''));
  return m ? m[1] : null;
}

/** Usage of a chat completion, normalised to the pilot's agy-like keys (input includes cache reads). */
export function meshUsage(u) {
  if (!u || typeof u !== 'object') return null;
  return { input_tokens: u.prompt_tokens ?? null, output_tokens: u.completion_tokens ?? null,
    cache_read_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    thinking_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0, total_tokens: u.total_tokens ?? null };
}

const sessions = new Map();
async function bearer(base, sessionId, fetchImpl) {
  const key = `${base}|${sessionId}`;
  if (!sessions.has(key)) {
    sessions.set(key, (async () => {
      const res = await fetchImpl(`${base}/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || typeof j.gatewayToken !== 'string' || !j.gatewayToken) throw new Error(`llm-mesh session refused (HTTP ${res.status})`);
      return j.gatewayToken;
    })().catch((e) => { sessions.delete(key); throw e; }));
  }
  return sessions.get(key);
}

/**
 * One mesh call. Returns the callSeat shape: { code, latencyMs, timedOut, text, usage, toolEvents,
 * toolKinds, errorEnvelope, stderrTail, attempts, served }. code 0 = answered by the requested
 * model; otherwise the HTTP status, MESH_SERVED_MISMATCH or MESH_TRANSPORT_ERROR.
 */
export async function callMesh(route, prompt, { timeoutMs = 900000, base = meshGateway(),
  sessionId = `classif-${route.label}-${process.pid}`, fetchImpl = fetch, sleepImpl = sleep, backoffMs = meshBackoff() } = {}) {
  const started = Date.now();
  const body = JSON.stringify({ model: route.mesh.model, reasoning: { effort: route.mesh.effort },
    messages: [{ role: 'user', content: prompt }] });
  let attempts = 0;
  let last = null;
  for (;;) {
    attempts++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const token = await bearer(base, sessionId, fetchImpl);
      const res = await fetchImpl(`${base}/v1/chat/completions`, { method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body });
      const served = servedModel(res.headers.get('x-sentropic-served'));
      const j = await res.json().catch(() => null);
      if (res.ok) {
        const msg = j?.choices?.[0]?.message ?? {};
        const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0;
        const base0 = { latencyMs: Date.now() - started, timedOut: false, usage: meshUsage(j?.usage), attempts, served,
          toolEvents: calls, toolKinds: calls ? { tool_calls: calls } : {} };
        if (served !== route.mesh.model) {
          return { ...base0, code: MESH_SERVED_MISMATCH, text: '', errorEnvelope: `served model ${served ?? '<none>'} instead of ${route.mesh.model}`,
            stderrTail: `served model ${served ?? '<none>'} instead of ${route.mesh.model}` };
        }
        return { ...base0, code: 0, text: typeof msg.content === 'string' ? msg.content : '', errorEnvelope: '', stderrTail: '' };
      }
      const why = `HTTP ${res.status}: ${String(j?.error?.message ?? '').slice(0, 300)}`;
      last = { code: res.status, why, served };
      if (!(res.status === 429 || res.status >= 500)) break;
    } catch (e) {
      last = { code: MESH_TRANSPORT_ERROR, why: ctl.signal.aborted ? 'timeout' : String(e?.message ?? e).slice(0, 300), served: null, timedOut: ctl.signal.aborted };
      if (ctl.signal.aborted) break;
    } finally { clearTimeout(timer); }
    if (attempts > backoffMs.length) break;
    await sleepImpl(backoffMs[attempts - 1]);
  }
  return { code: last.code, latencyMs: Date.now() - started, timedOut: Boolean(last.timedOut), text: '', usage: null, attempts, served: last.served,
    toolEvents: 0, toolKinds: {}, errorEnvelope: last.why, stderrTail: last.why };
}

/** A mesh call that ended unavailable after its retries (429, 5xx, transport, served mismatch). */
export function meshUnavailable(r) {
  return Boolean(r) && r.code !== 0 && (r.code === 429 || r.code >= 500 || r.code === MESH_TRANSPORT_ERROR || r.code === MESH_SERVED_MISMATCH);
}

const TRANSIENT = /\b(?:429|500|502|503|504)\b|resource[_ ]exhausted|\bunavailable\b|overloaded|temporarily|rate[ _-]?limit|too many requests|quota|deadline[_ ]exceeded|hit your [^\n]{0,40}\blimit\b|usage limit/i;
/**
 * A failed seat call that reads as a transient unavailability: a mesh one (codes), a timeout, or a
 * CLI error text (stderr or error envelope, never the answer) naming 429, 5xx, exhausted or
 * unavailable resources, a rate limit or a quota, or a seat usage limit (claude CLI 15/11:
 * « You've hit your Fable limit · resets ... », exit 1: a pause, never a scored failure).
 */
export function seatUnavailable(r) {
  if (!r || r.code === 0) return false;
  return meshUnavailable(r) || Boolean(r.timedOut) || TRANSIENT.test(`${r.stderrTail ?? ''}\n${r.errorEnvelope ?? ''}`);
}

export class MeshPause extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'MeshPause';
    Object.assign(this, details);
  }
}

/**
 * Mesh availability pause (owner 15/11: a 503 in the middle pauses, never consumes the one-shot
 * blind run): the first mesh call still unavailable after its retries stops every further launch;
 * the run stops before any aggregate or audit, answered items stay cached, and the same command
 * resumes. An unavailable call is never a scored failure.
 */
export function createMeshPauseGuard(isMesh) { // isMesh: routes the pause applies to (mesh and agy)
  let tripped = null;
  return {
    get tripped() { return tripped; },
    blocks: () => Boolean(tripped),
    observe(route, r) {
      if (!tripped && isMesh(route) && seatUnavailable(r)) tripped = { route, at: new Date().toISOString(), code: r.code };
      return tripped;
    },
    error(resumeCommand) {
      return new MeshPause(`mesh pause: ${tripped.route} unavailable (code ${tripped.code}) at ${tripped.at} after its retries; no further call launched, run stopped before any aggregate or audit (answered items are cached). Resume with \`${resumeCommand}\` once the model answers.`, { ...tripped });
    },
  };
}
