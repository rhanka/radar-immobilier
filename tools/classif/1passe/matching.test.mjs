import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchActs, validate, agreement, overlap, stage } from './matching.mjs';
const quote = 'Adoption du règlement 123-4 sur la densité résidentielle.';
const text = `${quote}\fAvis de motion du règlement 123-4.`;
const b = { id: 'b', label: 'Règlement 123-4 densité résidentielle', stage: 'adoption', citation: quote, page: 1 };
const a = { code: 'P-DENSITE', quote, page: 1, reason: 'Hausse de densité.', ambiguous: false, stage: 'adoption', target_number: '123-4' };
test('citation inventée et mauvaise page refusées', () => {
  const codes = new Map([['P-DENSITE', 'P']]);
  assert.equal(validate(a, text, codes).valid, true);
  assert.equal(validate({ ...a, page: 2 }, text, codes).evidencePage, 1);
  assert.equal(validate({ ...a, quote: `${quote} Inventé.` }, text, codes).valid, false);
});
test('analysis: flattened Ayers-Cliff and Barnston quotes preserve accents and evidence', () => {
  for (const q of [
    '881-883 Main, 828,\nStrathcona – Demande de PPCMOI',
    '329 rue\nTyler, Res-10 Projet PPCMOI construction 1\nbâtiment 2 étages 4 logement au total',
    'Rec-5- Projet plan\nglobale, future construction et Agrandissements\n(PIIA-9)',
    'Règlement numéro 325-2026 modifiant le\nrèglement numéro 224 Plan d’urbanisme',
  ]) {
    const unit = { ...b, label: q, citation: q.replaceAll('\n', ' '), stage: 'Dépôt et présentation' };
    const act = { ...a, target_number: null, quote: q.toUpperCase().normalize('NFD'), stage: 'projet_reglement' };
    assert.equal(matchActs([unit], [act], q).get('b'), act);
  }
  assert.equal(stage('Dépôt et présentation'), stage('projet_reglement'));
});
test('analysis: ambiguous S fallback remains a valid business vote', () => {
  const q = 'modifier le nombre de logements, le nombre\nd’étages et la hauteur permise pour une habitation multifamiliale dans la zone U-41';
  const vote = validate({ ...a, code: 'S-INFO-MANQUANTE', quote: q, ambiguous: true }, q,
    new Map([['S-INFO-MANQUANTE', 'S']]));
  assert.equal(vote.valid, true);
  assert.equal(vote.class, 'S');
  assert.equal(vote.ambiguous, true);
  assert.deepEqual(vote.issues, []);
});
test('analysis: physical page follows a unique anchor, original folio remains traceable', () => {
  const vote = validate({ ...a, page: 42 }, `cover\f${quote}`, new Map([['P-DENSITE', 'P']]));
  assert.equal(vote.valid, true);
  assert.equal(vote.page, 42);
  assert.equal(vote.evidencePage, 2);
  assert.equal(matchActs([{ ...b, page: 3 }], [vote], `cover\f${quote}`).size, 1);
  assert.equal(matchActs([{ ...b, page: 4 }], [vote], `cover\f${quote}`).size, 0);
});
test('overlap threshold and regulation token boundaries exclude weak evidence', () => {
  assert.equal(overlap('a'.repeat(29), 'a'.repeat(29)), false);
  assert.equal(overlap(`prefix ${'a'.repeat(30)}`, `${'a'.repeat(30)} suffix`), true);
  assert.equal(matchActs([{ ...b, label: '123-45', objet: '', anchor: '' }], [a], text).size, 0);
  assert.equal(matchActs([b], [{ ...a, quote: 'invented '.repeat(8) }], text).size, 0);
});
test('repeated quotations without a unique page remain invalid', () => {
  const v = validate({ ...a, page: null }, `${quote}\f${quote}`, new Map([['P-DENSITE', 'P']]));
  assert.equal(v.valid, false);
  assert.equal(v.class, 'P');
  assert.equal(v.status, 'invalide');
});
test('empty paired population has no artificial agreement or class', () => {
  const r = agreement([{ votes: [{ status: 'absent' }, { status: 'interrompu' }], disputed: true }]);
  assert.equal(r.n, 0);
  assert.equal(r.rawAgreement, null);
  assert.equal(r.kappa, null);
  assert.deepEqual(r.classes, ['P', 'S', 'N']);
});
test('recall groups share the same global uniqueness constraint', () => {
  const groups = [{ variants: [a, { ...a, quote: 'unrelated' }] }];
  assert.equal(matchActs([b], groups, text).get('b'), a);
  assert.equal(matchActs([b, { ...b, id: 'c' }], groups, text).size, 0);
});
test('globally forced assignments survive input reordering', () => {
  const q = 'Autorisation de construire quatre logements au 329 rue Tyler.';
  const source = `${quote}\n${q}`;
  const units = [b, { ...b, id: 'c', citation: q }];
  const acts = [{ ...a, target_number: null, quote: source }, { ...a, target_number: null }];
  for (const us of [units, [...units].reverse()]) for (const as of [acts, [...acts].reverse()]) {
    const result = matchActs(us, as, source);
    assert.equal(result.size, 2);
    assert.equal(result.get('b'), acts[1]);
    assert.equal(result.get('c'), acts[0]);
    assert.equal(result.collisions.length, 0);
  }
});
test('étapes et numéros incompatibles refusés ; pas de double affectation', () => {
  assert.equal(matchActs([b], [{ ...a, stage: 'avis de motion' }], text).size, 0);
  assert.equal(matchActs([b], [{ ...a, target_number: '999' }], text).size, 0);
  const collision = matchActs([b, { ...b, id: 'c' }], [a], text);
  assert.equal(collision.size, 0);
  assert.equal(collision.collisions.length, 2);
});
test('symmetric maximum assignments remain collisions', () => {
  assert.equal(matchActs([b, { ...b, id: 'c' }], [a, { ...a }], text).size, 0);
});
test('kappa conventionnel et accord validé distinguent les doubles omissions', () => {
  const rows = [
    { votes: [{ class: 'P', valid: true }, { class: 'P', valid: true }], disputed: false },
    { votes: [{ class: null, status: 'absent' }, { class: null, status: 'interrompu' }], disputed: true },
    { votes: [{ class: 'S', valid: true }, { class: 'N', valid: true }], disputed: true },
  ];
  const r = agreement(rows);
  assert.equal(r.rawAgreement, 1 / 2);
  assert.equal(r.validatedAgreement, 1 / 3);
  assert.equal(r.kappa, 1 / 3);
  assert.equal(r.excluded, 1);
});
