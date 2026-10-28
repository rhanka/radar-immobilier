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
