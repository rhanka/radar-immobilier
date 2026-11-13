import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchActs, validate, agreement } from './matching.mjs';
const quote = 'Adoption du règlement 123-4 sur la densité résidentielle.';
const text = `${quote}\fAvis de motion du règlement 123-4.`;
const b = { id: 'b', label: 'Règlement 123-4 densité résidentielle', stage: 'adoption', citation: quote, page: 1 };
const a = { code: 'P-DENSITE', quote, page: 1, reason: 'Hausse de densité.', ambiguous: false, stage: 'adoption', target_number: '123-4' };
test('citation inventée et mauvaise page refusées', () => {
  const codes = new Map([['P-DENSITE', 'P']]);
  assert.equal(validate(a, text, codes).valid, true);
  assert.equal(validate({ ...a, page: 2 }, text, codes).valid, false);
  assert.equal(validate({ ...a, quote: `${quote} Inventé.` }, text, codes).valid, false);
});
test('étapes et numéros incompatibles refusés ; pas de double affectation', () => {
  assert.equal(matchActs([b], [{ ...a, stage: 'avis de motion' }], text).size, 0);
  assert.equal(matchActs([b], [{ ...a, target_number: '999' }], text).size, 0);
  assert.equal(matchActs([b, { ...b, id: 'c' }], [a], text).size, 1);
});
test('cardinalité maximale par chemin augmentant', () => {
  assert.equal(matchActs([b, { ...b, id: 'c' }], [a, { ...a }], text).size, 2);
});
test('kappa conventionnel et accord validé distinguent les doubles omissions', () => {
  const rows = [
    { votes: [{ class: 'P' }, { class: 'P' }], disputed: false },
    { votes: [{ class: 'Non classé' }, { class: 'Non classé' }], disputed: true },
    { votes: [{ class: 'S' }, { class: 'N' }], disputed: true },
  ];
  const r = agreement(rows);
  assert.equal(r.rawAgreement, 2 / 3);
  assert.equal(r.validatedAgreement, 1 / 3);
  assert(Math.abs(r.kappa - 4 / 7) < 1e-12);
});
