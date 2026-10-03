import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    'D6 — Recette : qui porte « UAT OK »', 'https://github.com/rhanka/radar-immobilier/pull/795', 'l\'option', 'dit "oui"',
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

test('"Je suis" filter: own decisions = decided + named validations; consulted only is excluded; "toutes" keeps all', () => {
  assert.deepEqual(PEOPLE, ['Farid', 'Fabien']);
  const mine = person => decisionRecords(questions, {}, person, 'mine');
  const roles = person => Object.fromEntries(mine(person).map(record => [record.id, record.role]));
  assert.deepEqual(roles('Farid'), { D3: 'decide', D4: 'decide', D5: 'valide', D6: 'decide', D7: 'decide', D8: 'valide', D9: 'valide',
    D10: 'valide', D11: 'decide', D12: 'decide', D17: 'decide' });
  assert.equal(mine('Fabien').length, 13);
  assert.deepEqual(mine('Fabien').filter(record => record.role === 'valide').map(record => record.id), ['D11', 'D12']);
  // D1 and D16: Farid is only consulted, so they are not among his decisions.
  for (const id of ['D1', 'D16']) {
    assert.ok(questions.find(question => question.key === id).consulted.includes('Farid'), id);
    assert.ok(!mine('Farid').some(record => record.id === id), id);
  }
  const all = decisionRecords(questions, {}, 'Farid', 'all');
  assert.equal(all.length, 18);
  assert.equal(all.find(record => record.id === 'D16').role, null);
  assert.equal(new Set([...mine('Farid'), ...mine('Fabien')].map(record => record.id)).size, 18);
});

test('records: option id and label, statut, commentaire; unknown option rejected', () => {
  const state = { selections: { D12: 'a', D16: 'b', D15: 'a' }, comments: { D12: 'Colonne : oui\n« l\'étiquette » "porte:"' }, deferred: { D15: true } };
  const byId = Object.fromEntries(decisionRecords(questions, state, 'Fabien', 'all').map(record => [record.id, record]));
  const d12 = questions.find(question => question.key === 'D12');
  assert.deepEqual(byId.D12, {
    id: 'D12', titre: 'Cartes GitHub et board : conventions de la surface PO', role: 'valide', decide: 'Farid', consulte: 'Mathieu',
    option: 'a', option_libelle: d12.options[0].title, statut: 'tranchee', commentaire: state.comments.D12,
  });
  assert.equal(byId.D16.role, 'decide');
  assert.equal(byId.D15.statut, 'differee');
  assert.equal(byId.D15.option, 'a');
  assert.equal(byId.D1.statut, 'non_traitee');
  assert.equal(byId.D1.option, null);
  for (const record of Object.values(byId)) assert.ok(STATUSES.includes(record.statut));
  assert.throws(() => decisionRecords(questions, { selections: { D1: 'z' } }, 'Farid', 'all'), /Unknown option z for D1/);
});

test('export block: fenced YAML, agreed header, one entry per own decision', () => {
  const manifest = { title: 'Rôles et droits de décision dans radar-immobilier : application du modèle', htmlSha256: 'cd'.repeat(32),
    dossier: 'docs/spec/reports/dossier-roles-immo/DOSSIER_DECISION_ROLES_IMMO_2026-10-03.md' };
  const state = { selections: { D7: 'c', D16: 'b' }, comments: { D7: 'ligne 1\nligne 2' } };
  const { text, records } = exportBlock(manifest, state, 'Farid', 'mine', new Date('2026-10-03T12:00:00Z'));
  const lines = text.split('\n');
  assert.equal(lines[0], '```yaml');
  assert.equal(lines.at(-1), '```');
  assert.deepEqual(lines.slice(1, 8).map(line => line.split(':')[0]), ['dossier', 'fichier', 'version', 'decideur', 'date', 'coller_dans', 'decisions']);
  assert.equal(readScalar(lines[1].slice('dossier: '.length)), manifest.title);
  assert.equal(lines[2], 'fichier: DOSSIER_DECISION_ROLES_IMMO_2026-10-03.md');
  assert.equal(readScalar(lines[3].slice('version: '.length)), `r1 · sha256:${'cd'.repeat(32)}`);
  assert.equal(lines[4], 'decideur: Farid');
  assert.match(readScalar(lines[5].slice('date: '.length)), /^2026-10-0[23]T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(readScalar(lines[6].slice('coller_dans: '.length)), DECISIONS_TARGET_URL);
  assert.equal(DECISIONS_TARGET_URL, 'https://github.com/rhanka/radar-immobilier/pull/795');
  assert.equal(records.length, 11);
  assert.equal(lines.filter(line => line.startsWith('  - id: ')).length, 11);
  assert.ok(!text.includes('id: D16'));
  const d7 = text.split('  - id: D7\n')[1].split('\n  - id: ')[0].split('\n');
  assert.equal(d7[0], '    titre: "Orientation produit : décideur inscrit tant que la délégation n’est pas écrite"');
  assert.deepEqual(d7.slice(1, 5), ['    role: decide', '    decide: Farid', '    consulte: Mathieu, Steve, Fabien', '    option: c']);
  assert.equal(readScalar(d7[5].slice('    option_libelle: '.length)), questions.find(question => question.key === 'D7').options[2].title);
  assert.deepEqual(d7.slice(6), ['    statut: tranchee', '    commentaire: |', '      ligne 1', '      ligne 2']);
  assert.match(text, /  - id: D5\n    titre: [^\n]*\n    role: valide\n    decide: Fabien\n/);
  assert.equal(decisionsYaml({}, []).split('\n').at(-1), 'decisions: []');
});

test('D12 and §8.3: PO validation column on the board, decisions pasted as YAML in the card', async () => {
  const markdown = await readFile('../DOSSIER_DECISION_ROLES_IMMO_2026-10-03.md', 'utf8');
  const column = '« Validation PO (UAT preprod, orientations design) »';
  const d12 = markdown.split('\n### D12 — ')[1].split('\n### D13 — ')[0];
  const surfaces = markdown.split('\n### 8.3 Application par surface')[1].split('\n### 8.4 ')[0];
  const board = surfaces.split('\n').find(line => line.startsWith('| Board |'));
  const card = surfaces.split('\n').find(line => line.startsWith('| Carte GitHub de type décision |'));
  for (const text of [d12, board]) {
    assert.ok(text.includes(column) && text.includes('cartes de décision et d\'orientation adressées au PO'), text.slice(0, 120));
    assert.ok(text.includes('les cartes de mise en œuvre restent en design ou en dev'), text.slice(0, 120));
  }
  // The former name only appears as such.
  for (const match of markdown.matchAll(/« Déployé sur preprod \(UAT\) »/g)) assert.match(markdown.slice(match.index - 12, match.index), /ancien nom $/);
  assert.ok(d12.includes('les décisions se collent en YAML dans la carte') && card.includes('les décisions s\'y collent en YAML'));
  assert.ok(questions.find(question => question.key === 'D12').options[0].title.includes(column));
  for (const source of [markdown, await readFile('DecisionChoices.svelte', 'utf8'), await readFile('decision-yaml.js', 'utf8'), await readFile('choices.js', 'utf8')])
    assert.ok(!/honn[êe]te/i.test(source));
});

test('the JSON pack stays available internally, for the backend connection', () => {
  const pack = responsePack({ dossier: 'x', dossierHash: 'h', artifactInputHash: 'i' }, { D12: 'a' });
  assert.equal(pack.responses.length, 18);
  assert.equal(pack.responses.find(response => response.key === 'D12').selection, 'a');
});
