// Synthetic data only: never real sheet content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, citationSegments, diffFresh, slugify } from './chaperon-reprise-plan.mjs';

const header = ['#', 'Ville', 'Sens (Steve)', 'Classement (Steve)', 'Code motif (Steve)', 'ID signal', 'Lien PV', 'Citation'];
const csv = (rows) => '﻿' + [header, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';

test('one target per node id, verdict and code carried', () => {
  const plan = buildPlan(csv([
    ['1', 'Ville-Test', 'Assouplissement', 'Pertinent', 'P-DENSITE', 'signal-ville-test-a\nevent-ville-test-b',
      'https://x/api/documents/raw?rawRef=raw%2Fa.pdf#page=2', '[p. 2] « Avis de motion du règlement 1 »'],
    ['2', 'Ville-Test', 'Neutre', 'Non pertinent', 'V2-PRECEDENT', 'signal-ville-test-c', '', 'x'],
  ]));
  assert.equal(plan.targets.length, 3);
  assert.deepEqual(plan.targets.map((t) => t.verdict), ['pertinent', 'pertinent', 'non_pertinent']);
  assert.deepEqual(plan.targets[0].rawRefs, ['raw/a.pdf']);
  assert.equal(plan.targets[2].reasonCode, 'V2-PRECEDENT');
});

test('rows without classement, code or node id are reported, not planned', () => {
  const plan = buildPlan(csv([['3', 'V', '', 'Peut-être', 'X', 'signal-v-a', '', ''], ['4', 'V', '', 'Pertinent', '', 'signal-v-b', '', ''],
    ['5', 'V', '', 'Pertinent', 'P-DENSITE', '', '', '']]));
  assert.equal(plan.targets.length, 0);
  assert.deepEqual(plan.issues.map((i) => i.issue), ['unknown_classement', 'missing_reason_code', 'no_node_id']);
});

test('duplicate node ids collapse when consistent and are excluded when conflicting', () => {
  const plan = buildPlan(csv([
    ['1', 'V', '', 'Pertinent', 'P-DENSITE', 'signal-v-a\nsignal-v-b', '', ''],
    ['2', 'V', '', 'Pertinent', 'P-DENSITE', 'signal-v-a', '', ''],
    ['3', 'V', '', 'Non pertinent', 'N-FORME', 'signal-v-b', '', ''],
  ]));
  assert.deepEqual(plan.targets.map((t) => [t.row, t.nodeId]), [[1, 'signal-v-a']]);
  assert.deepEqual(plan.issues.map((i) => [i.row, i.issue]), [['1+2', 'duplicate_merged'], ['1+3', 'conflicting_duplicate']]);
});

test('citation segments and slugs are normalized', () => {
  assert.deepEqual(citationSegments('[p. 3] « Zone H-12 »  [p. 4] « Règlement 9 »').map((s) => s.page), [3, 4]);
  assert.equal(slugify('Saint-Jean-sur-Richelieu (Ville de)'), 'saint-jean-sur-richelieu-ville-de');
});

test('fresh export diff reports decision and id changes by row number', () => {
  const text = csv([['1', 'V', 'Neutre', 'Pertinent', 'P-DENSITE', 'signal-v-A1', '', '']]);
  const fresh = [{ n: 6, cells: { A: '1.0', P: 'Neutre', Q: 'À surveiller', R: 'S-PLANIFIE', L: 'signal-v-B2 — objet' } },
    { n: 7, cells: { A: '2.0' } }];
  assert.deepEqual(diffFresh(text, fresh), { freshRows: 2, sealedRows: 1, missingInFresh: [], newInFresh: [2],
    decisionChanged: [1], nodeIdChanged: [1] });
});
