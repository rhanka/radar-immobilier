import test from 'node:test';
import assert from 'node:assert/strict';
import { readCheck } from '../../deploy/base-preprod/public-probe.mjs';
const config = { workspaceId: 'fixture-workspace', citySlug: 'fixture-city' };
const spec = { name: 'projection-revisions', path: '/api/v1/workspaces/:workspaceId/signal-facets/projection-revisions', expected: 200 };
const headers = { 'content-type': 'application/json', 'cache-control': 'private, no-store', vary: 'Cookie' };
test('refuse explicitement un JSON invalide reçu en HTTP 200', async () => {
  const checks = [];
  await readCheck(checks, spec, config, async () => new Response('non-json', { headers }));
  assert.equal(checks[0].status, 200);
  assert.equal(checks[0].passed, false);
  assert.equal(checks[0].failurePhase, 'json-parse');
});
test('ne transforme pas une réponse JSON null en erreur de transport', async () => {
  const checks = [];
  await readCheck(checks, spec, config, async () => new Response('null', { headers }));
  assert.equal(checks[0].status, 200);
  assert.equal(checks[0].passed, false);
  assert.equal(checks[0].failurePhase, 'json-schema');
});

test('conserve le statut lors d’une interruption de lecture du corps', async () => {
  const checks = [];
  await readCheck(checks, spec, config, async () => ({ status: 200, headers: new Headers(headers),
    text: async () => { throw new TypeError('corps confidentiel'); } }));
  assert.equal(checks[0].status, 200);
  assert.equal(checks[0].failurePhase, 'body-read');
  assert.equal(JSON.stringify(checks).includes('confidentiel'), false);
});
test('distingue une erreur réseau sans publier son message', async () => {
  const checks = [];
  await readCheck(checks, spec, config, async () => { throw new TypeError('donnée confidentielle'); });
  assert.equal(checks[0].status, 0);
  assert.equal(checks[0].failurePhase, 'fetch');
  assert.equal(checks[0].errorType, 'TypeError');
  assert.equal(JSON.stringify(checks).includes('confidentielle'), false);
});
test('utilise GET et refuse toute méthode mutatrice avant le transport', async () => {
  const checks = [];
  let calls = 0;
  const request = async (path, options) => {
    calls++; assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return new Response('{"ok":true}', { headers });
  };
  await readCheck(checks, spec, config, request);
  await readCheck(checks, { ...spec, method: 'POST' }, config, request);
  assert.equal(calls, 1);
  assert.equal(checks[0].passed, true);
  assert.equal(checks[1].failurePhase, 'configuration');
});
