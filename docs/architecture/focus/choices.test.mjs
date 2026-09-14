import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixedInstructions, questions, responsePack } from './choices.js';

const { manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const options = ['sonnet-comparable', 'luna-low', 'gemini38-lowest'];

test('M1 is the first question and preserves the exact three-candidate set', () => {
  assert.equal(questions.length, 3);
  assert.equal(questions[0].key, 'm1-model');
  assert.deepEqual(questions[0].options.map(option => option.key), options);
  assert.match(questions[0].options[0].detail, /clé owner hors dépôt et hors logs/);
  assert.match(questions[0].context, /no-output Gemini reste non classable/);
});
test('Gemini no-output is an attempt, never a result or ranking', () => {
  const pack = responsePack(manifest);
  assert.equal(pack.revision, 'D9');
  assert.deepEqual(pack.m1Decision.optionSet, options);
  assert.deepEqual(pack.m1Decision.candidateRows.map(row => row.optionId), options);
  assert.deepEqual(pack.m1Decision.candidateResults, []);
  assert.deepEqual(pack.m1Decision.ranking, []);
  assert.equal(pack.m1Decision.ratifiedOptionId, null);
  const attempt = pack.m1Decision.attempts[0];
  assert.deepEqual({ classification: attempt.classification, output: attempt.output, qualityMetrics: attempt.qualityMetrics,
    validOutputLatencyMs: attempt.validOutputLatencyMs, rank: attempt.rank },
  { classification: 'not-classifiable', output: null, qualityMetrics: null, validOutputLatencyMs: null, rank: null });
});

test('a browser selection is only a draft and cannot ratify M1', () => {
  const pack = responsePack(manifest, { 'm1-model': 'sonnet-comparable' });
  assert.equal(pack.m1Decision.draftSelectedOptionId, 'sonnet-comparable');
  assert.equal(pack.m1Decision.ratifiedOptionId, null);
  assert.equal(fixedInstructions.transitionEvidence.t1.production, 'dormant-pending-promotion');
  assert.equal(fixedInstructions.transitionEvidence.t1.selectedProductionModel, null);
});
