import test from 'node:test';
import assert from 'node:assert/strict';
import { responsePack } from './choices.js';
test('every LLM allocation choice round-trips without inventing a bill or reopening fixed work', () => {
  for (const choice of [null, 'DIRECT', 'USAGE', 'CAPACITY']) {
    const result = JSON.parse(JSON.stringify(responsePack({ dossierHash: 'd', artifactInputHash: 'a' }, choice, 'Réserve : "reprise"\nà vérifier', 'General notes', '2026-09-13T00:00:00Z')));
    assert.equal(result.decision.option, choice);
    assert.equal(result.decision.key, 'llm-allocation-method');
    assert.equal(result.decision.note, 'Réserve : "reprise"\nà vérifier');
    assert.deepEqual(result.options.map(o => o.key), ['DIRECT', 'USAGE', 'CAPACITY']);
    assert.equal(result.status, 'draft-not-ratified'); assert.equal(result.buildOnly, true);
    assert.equal(result.artifactInputHash, 'a'); assert.equal(result.dossierHash, 'd');
    assert.equal(result.fixedDecisions.retainScwTemUntilValidatedReplacement, true);
    assert.deepEqual(result.fixedDecisions.executionOrder, ['T1-refresh-graphify-0.18.0', 'T2-minio-final-scw-sweep', 'T3-one-b3-8']);
    assert.equal(result.fixedDecisions.infrastructureBilling.projectedNodeCad, 59.04);
    assert.equal(result.fixedDecisions.monetaryProposalAudit, 'incomplete');
    assert.equal('finalBillableCad' in result, false);
    assert.equal('approved' in result, false);
  }
  assert.throws(() => responsePack({}, 'OTHER', '', '', null), /Unknown/);
});
