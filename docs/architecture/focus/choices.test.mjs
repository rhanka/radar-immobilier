import test from 'node:test';
import assert from 'node:assert/strict';
import { responsePack } from './choices.js';
test('every choice and its exact comment round-trip with all options and provenance as a draft', () => {
  for (const choice of [null, 'A', 'B', 'C']) {
    const result = JSON.parse(JSON.stringify(responsePack({ dossierHash: 'd', artifactInputHash: 'a' }, choice, 'Réserve : "reprise"\nà vérifier', 'General notes', '2026-09-13T00:00:00Z')));
    assert.equal(result.decision.option, choice);
    assert.equal(result.decision.note, 'Réserve : "reprise"\nà vérifier');
    assert.deepEqual(result.options.map(o => o.key), ['A', 'B', 'C']);
    assert.equal(result.status, 'draft-not-ratified'); assert.equal(result.buildOnly, true);
    assert.equal(result.artifactInputHash, 'a'); assert.equal(result.dossierHash, 'd');
    assert.equal(result.fixedDecisions.retainScwTemUntilValidatedReplacement, true);
    assert.equal('approved' in result, false);
  }
  assert.throws(() => responsePack({}, 'D', '', '', null), /Unknown/);
});
