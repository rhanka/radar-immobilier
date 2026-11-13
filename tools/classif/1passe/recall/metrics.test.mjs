import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metric, pair, predictionClass } from './metrics.mjs';
test('Wilson remains below one with zero misses and undefined with no support', () => {
  assert(Math.abs(metric(1, 1).wilsonLower95 - 0.20654931437723745) < 1e-12);
  assert.equal(metric(0, 0).recall, null);
  assert(metric(0, 100).wilsonLower95 < 1e-12);
});
test('a multi-citation group covers only one B act; distinct stages do not merge', () => {
  const quote = 'Adoption du règlement 2026-10 relatif aux logements supplémentaires';
  const unit = { id: 'b1', stage: 'adoption', label: '2026-10 logements', objet: '', citation: quote };
  const a = { id: 'a', stage: 'adoption', quote, object: 'logements', target_number: '2026-10' };
  const matched = pair([unit, { ...unit, id: 'b2' }], [{ id: 'g', variants: [a, a] }], quote);
  assert.equal(matched.size, 1);
  assert.equal(pair([unit], [{ ...a, stage: 'avis de motion' }], quote).size, 0);
  assert.equal(pair([{ id: 'neutral-a07', variants: [unit, unit] }], [a, a], quote).size, 1);
});
test('ambiguity preserves a valid production class; inconsistent class stays visible', () => {
  const codes = new Map([['N-FORME', 'N']]);
  assert.equal(predictionClass({ classe: 'ecarte', code: 'N-FORME', ambiguous: true, reason: 'Step 6: form.' }, codes), 'N');
  assert.equal(predictionClass({ classe: 'pertinent', code: 'N-FORME', reason: 'mismatch' }, codes), 'Non classé');
});
