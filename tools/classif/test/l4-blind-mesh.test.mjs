// Blind executor on the llm-mesh route (owner 15/11): pilot stop with infrastructure counts only,
// mesh pause on a model still unavailable after its retries (no audit, nothing consumed), resume
// without losing answered items. Hermetic: fake gateway (stubbed fetch, test-only URL), temp home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { swapEnv, withTempHome } from './hermetic-helpers.mjs';
import { SCORE_KEYS, auditOf, blindIds, blindPass, setupBlind } from './l4-blind-fixture.mjs';

const K = '96';
const ROUTE = 'gemini-4-argon-low';
const IDS = blindIds(10);

/** Fake gateway: `down(itemId)` decides a 503; otherwise P-DENSITE served as the requested model. */
function fakeMesh(down = () => false) {
  const real = globalThis.fetch;
  const restores = [swapEnv('CLASSIF_MESH_GATEWAY', 'http://fake-mesh.invalid'), swapEnv('CLASSIF_TEST_MESH_BACKOFF_MS', '1,1')];
  const reply = (status, body, model) => ({ ok: status < 300, status, json: async () => body,
    headers: { get: (h) => (h === 'x-sentropic-served' && model ? `provider=gemini; model=${model}; transport=cloud-code` : null) } });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('http://fake-mesh.invalid/')) throw new Error(`unexpected network call: ${url}`);
    if (String(url).endsWith('/v1/session')) return reply(201, { gatewayToken: 'fake' });
    calls++;
    const body = JSON.parse(init.body);
    const id = /item_id: ([A-Za-z0-9._-]+)/.exec(body.messages[0].content)?.[1] ?? '';
    if (down(id)) return reply(503, { error: { message: 'account service temporarily unavailable' } }, body.model);
    return reply(200, { choices: [{ message: { content: '{"verdict":"pertinent","code":"P-DENSITE"}' } }] }, body.model);
  };
  return { calls: () => calls, restore: () => { globalThis.fetch = real; while (restores.length) restores.pop()(); } };
}

const blindRuns = (home) => auditOf(home).filter((e) => e.action === 'blind-run').length;

test('mesh blind: pilot stops with counts only, a 503 pauses without audit, the resume reuses answered items', withTempHome(async (home) => {
  const s = await setupBlind(home, { k: K, routes: [ROUTE], ids: IDS });
  try {
    let gw = fakeMesh();
    const pilot = await blindPass(home, { k: K, routes: [ROUTE], concurrency: 1, argv: ['--pilot', '3'] });
    gw.restore();
    assert.equal(pilot.error?.name, 'BlindPilotStop', pilot.error?.stack);
    assert.deepEqual(pilot.error.summary, { route: ROUTE, launched: 3, answered: 3, infraFailed: 0, answerFailed: 0, why: {} });
    for (const key of SCORE_KEYS) assert.ok(!JSON.stringify(pilot.error.summary).includes(key), `pilot summary carries no ${key}`);
    assert.equal(blindRuns(home), 0, 'a pilot never consumes the one-shot run');

    // From item 6 on the gateway is down: 2 more answered (b-004, b-005), then the pause.
    gw = fakeMesh((id) => id >= 'b-006');
    const paused = await blindPass(home, { k: K, routes: [ROUTE], concurrency: 1 });
    gw.restore();
    assert.equal(paused.error?.name, 'MeshPause', paused.error?.stack);
    assert.equal(paused.calls.filter((c) => c.intent).length, 3, 'b-004, b-005, then the unavailable b-006 only');
    assert.equal(blindRuns(home), 0);
    assert.ok(!existsSync(path.join(home, 'blind', `series-${K}-aggregates.json`)));

    gw = fakeMesh();
    const done = await blindPass(home, { k: K, routes: [ROUTE], concurrency: 1 });
    gw.restore();
    assert.equal(done.error, null, done.error?.stack);
    const blindCalls = done.calls.filter((c) => c.intent && c.phase === `l4-blind-s${K}`).length;
    assert.equal(blindCalls, 5, 'only b-006..b-010 are called again');
    assert.equal(blindRuns(home), 1);
    assert.ok(existsSync(path.join(home, 'blind', `series-${K}-aggregates.json`)));
  } finally { s.cleanup(); }
}));
