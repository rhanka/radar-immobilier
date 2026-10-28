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

const { readFileSync } = await import('node:fs');
const { publicQualification } = await import('../../deploy/base-preprod/public-probe.mjs');
const { fixtureFetch, fixtureConfig } = await import('./base-preprod-probe-fixture.mjs');
const publicCases = JSON.parse(readFileSync(new URL('../../deploy/base-preprod/public-checks.json', import.meta.url), 'utf8'));
test('qualifie Q1 et Q2 authentifiés simulés sans exporter de valeur privée', async () => {
  for (const phase of ['q1', 'q2']) {
    const cfg = { ...fixtureConfig, phase };
    const result = await publicQualification(cfg, publicCases, fixtureFetch(cfg, publicCases));
    assert.equal(result.passed, true);
    assert.equal(result.checks.length, publicCases.length);
    assert.equal(result.projectionRevisionReadable, true);
    assert.equal(JSON.stringify(result).includes('sensitive-fixture-only'), false);
    assert.equal(result.businessMutations, 0);
  }
});
test('limite le préflight aux trois lectures de disponibilité et de session', async () => {
  const cfg = { ...fixtureConfig, phase: 'preflight' };
  const result = await publicQualification(cfg, publicCases, fixtureFetch(cfg, publicCases));
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks.map(x => x.name), ['health', 'session', 'workspaces']);
});
test('refuse Q1 lorsque le JSON de coherent-city est inexploitable', async () => {
  const result = await publicQualification(fixtureConfig, publicCases,
    fixtureFetch(fixtureConfig, publicCases, { 'coherent-city': 'non-json' }));
  assert.equal(result.passed, false);
  assert.equal(result.checks.find(x => x.name === 'coherent-city').failurePhase, 'json-parse');
});

const { probeConfig } = await import('../../deploy/base-preprod/public-cli.mjs');
test('limite la configuration publique à la préprod et au SHA complet', () => {
  const input = { namespace: 'radar-immobilier-preprod', binding: {
    workspaceId: fixtureConfig.workspaceId, actorSub: fixtureConfig.actorSub, releaseId: fixtureConfig.releaseSha + ':fixture' } };
  assert.equal(probeConfig(input, 'q1').origin, 'https://preprod.immo.sent-tech.ca');
  assert.throws(() => probeConfig({ ...input, namespace: 'radar-immobilier' }, 'q1'), { message: 'invalid_probe_input' });
  assert.throws(() => probeConfig({ ...input, binding: { ...input.binding, releaseId: 'short' } }, 'q1'));
  assert.throws(() => probeConfig(input, 'rollback'));
});
