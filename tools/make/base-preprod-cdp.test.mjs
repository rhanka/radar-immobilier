import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCdpQualification } from '../../deploy/base-preprod/cdp-probe.mjs';
import { fixtureConfig } from './base-preprod-probe-fixture.mjs';
import { cdpFixture } from './base-preprod-cdp-fixture.mjs';
const cases = JSON.parse(readFileSync(new URL('../../deploy/base-preprod/public-checks.json', import.meta.url), 'utf8'));
const config = { ...fixtureConfig, origin: 'https://preprod.immo.sent-tech.ca' };
test('Q1 et Q2 CDP ne créent et ferment que leur onglet dédié', async () => {
  for (const phase of ['q1', 'q2']) {
    const cfg = { ...config, phase }, transport = cdpFixture(cfg, cases);
    const result = await runCdpQualification(cfg, cases, transport);
    assert.equal(result.passed, true); assert.equal(result.ownedTargetClosed, true);
    assert.equal(transport.trace.some(x => x.method === 'Network.enable' || x.method === 'Page.enable'), false);
    assert.deepEqual(transport.trace.filter(x => x.path), [
      { method: 'PUT', path: '/json/new' }, { method: 'GET', path: '/json/close/owned-fixture' }]);
    assert.equal(result.cookiesExported, false); assert.equal(result.tokensExported, false);
    assert.equal(JSON.stringify(result).includes('sensitive-fixture-only'), false);
  }
});
test('ferme l’onglet et identifie la phase après échec de révisions', async () => {
  const result = await runCdpQualification(config, cases, cdpFixture(config, cases, 'network'));
  assert.equal(result.passed, false); assert.equal(result.ownedTargetClosed, true);
  assert.equal(result.checks.find(x => x.name === 'projection-revisions').failurePhase, 'fetch');
  assert.equal(JSON.stringify(result).includes('sensitive-fixture-only'), false);
});
test('ferme aussi l’onglet après une erreur de protocole CDP', async () => {
  const result = await runCdpQualification(config, cases, cdpFixture(config, cases, 'command'));
  assert.equal(result.passed, false); assert.equal(result.ownedTargetClosed, true);
  assert.equal(result.error, 'cdp_command_failed');
});
