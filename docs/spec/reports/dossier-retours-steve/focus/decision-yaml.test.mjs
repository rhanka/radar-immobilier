import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yamlScalar, yamlBlock, isoWithOffset, decisionRecords, decisionsYaml, STATUSES } from './decision-yaml.js';
import { questions, exportBlock, responsePack, PEOPLE, DECISIONS_TARGET_URL } from './choices.js';

// Reads back what the emitter writes, without a YAML dependency: double-quoted scalars
// use JSON-compatible escapes, literal blocks are de-indented.
const readScalar = text => text === 'null' ? null : text.startsWith('"') ? JSON.parse(text) : text;
const readBlock = (text, indent) => {
  const [header, ...lines] = text.split('\n');
  assert.match(header, /^\|2?$/);
  return lines.map(line => line.slice(indent)).join('\n');
};

test('scalars: plain only when unambiguous, otherwise double-quoted and reversible', () => {
  const plain = ['Farid', 'D12', 'Steve, Mathieu, Fabien', '(a) Triage seul', 'M3 — couches hôtes + projection conforme', '—', 'tranchee'];
  for (const value of plain) assert.equal(yamlScalar(value), value, value);
  const quoted = [
    'D6 — Recette : qui porte « UAT OK »', 'https://github.com/rhanka/radar-immobilier/pull/794', 'l\'option', 'dit "oui"',
    '#784', 'a # b', '- liste', '? clé', '& ancre', '* alias', '! tag', '| bloc', '> plié', '% directive', '@x', '`x`', '[x]', '{x}',
    '1', '2026-10-03', '-1', '.5', 'null', 'True', 'no', 'off', '~', '.inf', '', ' espace', 'fin ', 'tab\tici',
    'deux\nlignes', 'C:\\chemin', 'nul\u0000', 'sep\u2028', 'bom\ufeff', 'del\u007f',
  ];
  for (const value of quoted) {
    const out = yamlScalar(value);
    assert.ok(out.startsWith('"') && out.endsWith('"'), `${JSON.stringify(value)} -> ${out}`);
    assert.ok(!/[\n\r\t\u0000\u2028\ufeff\u007f]/.test(out), `raw control character in ${out}`);
    assert.equal(readScalar(out), value, `round trip of ${JSON.stringify(value)}`);
  }
  assert.equal(yamlScalar('dit "oui"'), '"dit \\"oui\\""');
  assert.equal(yamlScalar('C:\\x'), '"C:\\\\x"');
  assert.equal(yamlScalar(null), 'null');
  assert.equal(yamlScalar(undefined), 'null');
});

test('commentaire: literal block, normalised, indented, never closes the Markdown fence', () => {
  assert.equal(yamlBlock('', 6), '|');
  assert.equal(yamlBlock('  \n\n', 6), '|');
  const text = 'Ligne 1 : "oui" # pas un commentaire\r\nl\'option b\n\n```\n- pas une liste';
  const out = yamlBlock(`\n${text}\n\n  `, 6);
  assert.equal(out, '|\n      Ligne 1 : "oui" # pas un commentaire\n      l\'option b\n\n      ```\n      - pas une liste');
  assert.equal(readBlock(out, 6), text.replace(/\r\n/g, '\n'));
  assert.equal(yamlBlock('  indenté\nsuite', 6), '|2\n        indenté\n      suite');
  assert.equal(yamlBlock('bip\u0007', 6), '"bip\\u0007"');
});

test('date: ISO-8601 with an explicit UTC offset', () => {
  assert.match(isoWithOffset(new Date('2026-10-03T12:34:56Z')), /^2026-10-0[23]T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('"Je suis" filter: own decisions only (decider or named validator), "toutes" keeps all', () => {
  assert.deepEqual(PEOPLE, ['Farid', 'Fabien']);
  const mine = person => decisionRecords(questions, {}, person, 'mine');
  // This dossier names no validation: own decisions = decisions decided.
  assert.equal(mine('Farid').length, 10);
  assert.equal(mine('Fabien').length, 6);
  assert.ok(mine('Farid').every(record => record.decide === 'Farid' && record.role === 'decide'));
  // D9: Fabien decides, Farid is only consulted, so it is not one of Farid's.
  assert.ok(questions.find(question => question.key === 'D9').consulted.includes('Farid'));
  assert.ok(!mine('Farid').some(record => record.id === 'D9'));
  assert.ok(mine('Fabien').some(record => record.id === 'D9'));
  const all = decisionRecords(questions, {}, 'Farid', 'all');
  assert.equal(all.length, 16);
  assert.equal(all.find(record => record.id === 'D9').role, null);
  assert.equal(new Set([...mine('Farid'), ...mine('Fabien')].map(record => record.id)).size, 16);
});

test('records: option id and label, statut, commentaire; unknown option rejected', () => {
  const state = { selections: { D12: 'a', D9: '1', D13: 'b' }, comments: { D12: 'Voir #787 : oui' }, deferred: { D13: true } };
  const byId = Object.fromEntries(decisionRecords(questions, state, 'Farid', 'all').map(record => [record.id, record]));
  assert.deepEqual(byId.D12, {
    id: 'D12', titre: 'Exposition A/B/C (point ouvert)', role: 'decide', decide: 'Farid', consulte: 'Steve, Mathieu, Fabien',
    option: 'a', option_libelle: '(a) C en shadow, comparaison réservée UAT, puis remplacement de B', statut: 'tranchee', commentaire: 'Voir #787 : oui',
  });
  assert.equal(byId.D13.statut, 'differee');
  assert.equal(byId.D13.option, 'b');
  assert.equal(byId.D1.statut, 'non_traitee');
  assert.equal(byId.D1.option, null);
  assert.equal(byId.D9.option, '1');
  for (const record of Object.values(byId)) assert.ok(STATUSES.includes(record.statut));
  assert.throws(() => decisionRecords(questions, { selections: { D1: 'z' } }, 'Farid', 'all'), /Unknown option z for D1/);
});

test('export block: fenced YAML, agreed header, one entry per own decision', () => {
  const manifest = { title: 'Analyse des retours d\'usage du 21 septembre 2026 : capitalisation', htmlSha256: 'ab'.repeat(32),
    dossier: 'docs/spec/reports/dossier-retours-steve/DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md' };
  const state = { selections: { D12: 'a', D9: '1' }, comments: { D12: 'ligne 1\nligne 2' } };
  const { text, records } = exportBlock(manifest, state, 'Farid', 'mine', new Date('2026-10-03T12:00:00Z'));
  const lines = text.split('\n');
  assert.equal(lines[0], '```yaml');
  assert.equal(lines.at(-1), '```');
  assert.deepEqual(lines.slice(1, 8).map(line => line.split(':')[0]), ['dossier', 'fichier', 'version', 'decideur', 'date', 'coller_dans', 'decisions']);
  assert.equal(readScalar(lines[1].slice('dossier: '.length)), manifest.title);
  assert.equal(lines[2], 'fichier: DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md');
  assert.equal(readScalar(lines[3].slice('version: '.length)), `2026-10-03 · sha256:${'ab'.repeat(32)}`);
  assert.equal(lines[4], 'decideur: Farid');
  assert.match(readScalar(lines[5].slice('date: '.length)), /^2026-10-0[23]T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(readScalar(lines[6].slice('coller_dans: '.length)), DECISIONS_TARGET_URL);
  assert.equal(DECISIONS_TARGET_URL, 'https://github.com/rhanka/radar-immobilier/pull/794');
  assert.equal(records.length, 10);
  assert.equal(lines.filter(line => line.startsWith('  - id: ')).length, 10);
  assert.ok(!text.includes('id: D9'));
  const d12 = text.split('  - id: D12\n')[1].split('\n  - id: ')[0];
  assert.equal(d12, [
    '    titre: Exposition A/B/C (point ouvert)', '    role: decide', '    decide: Farid', '    consulte: Steve, Mathieu, Fabien',
    '    option: a', '    option_libelle: (a) C en shadow, comparaison réservée UAT, puis remplacement de B', '    statut: tranchee',
    '    commentaire: |', '      ligne 1', '      ligne 2',
  ].join('\n'));
  assert.equal(decisionsYaml({}, []).split('\n').at(-1), 'decisions: []');
});

test('the JSON pack stays available internally, for the backend connection', () => {
  const pack = responsePack({ dossier: 'x', dossierHash: 'h', artifactInputHash: 'i' }, { D12: 'a' });
  assert.equal(pack.responses.length, 16);
  assert.equal(pack.responses.find(response => response.key === 'D12').selection, 'a');
});
