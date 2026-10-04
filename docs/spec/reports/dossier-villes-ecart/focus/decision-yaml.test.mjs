import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Two independent YAML readers, from the repository root node_modules (the Makefile
// mounts it at /node_modules): `yaml` (YAML 1.2 core) and `js-yaml` (with timestamps).
import YAML from 'yaml';
import jsyaml from 'js-yaml';
import { yamlScalar, yamlBlock, isoWithOffset, decisionRecords, decisionsYaml, STATUSES } from './decision-yaml.js';
import { questions, exportBlock, responsePack, PEOPLE, DECISIONS_TARGET_URL } from './choices.js';

const READERS = { yaml: text => YAML.parse(text), 'js-yaml': text => jsyaml.load(text) };
// Reads `value` back through each reader, as a header value (indent 2) and as a record
// value (indent 6), and returns what each reader loaded.
const readBack = value => Object.entries(READERS).flatMap(([name, load]) => [
  [name, load(`k: ${yamlScalar(value, 2)}\nnext: 1\n`).k],
  [name, load(`list:\n  - id: X\n    k: ${yamlScalar(value, 6)}\n    next: 1\n`).list[0].k],
]);
const noQuotes = out => !/^["']/.test(out);

test('scalars: plain whenever YAML reads them back unchanged, never quoted', () => {
  const plain = [
    'Farid', 'D12', 'Steve, Mathieu, Fabien', '(a) Triage seul', 'M3 — couches hôtes + projection conforme', '—', 'tranchee',
    'l\'option', 'Analyse des retours d\'usage', 'dit "oui"', 'C#', 'issue#784', 'https://github.com/rhanka/radar-immobilier/pull/794',
    `2026-10-03 · sha256:${'0b'.repeat(32)}`, 'sha256:abc', '1er avis', '2026-10-03 matin', '10 décisions', 'a, [b] {c}', 'x:y', 'C:\\chemin',
  ];
  for (const value of plain) {
    assert.equal(yamlScalar(value), value, value);
    for (const [name, read] of readBack(value)) assert.equal(read, value, `${name}: ${value}`);
  }
  assert.equal(yamlScalar(null), 'null');
  assert.equal(yamlScalar(undefined), 'null');
});

test('date: plain ISO-8601 date-time, loaded as a timestamp by js-yaml, as a string by yaml', () => {
  const iso = isoWithOffset(new Date('2026-10-04T13:25:28Z'));
  assert.match(iso, /^2026-10-0[34]T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(yamlScalar(iso), iso);
  assert.equal(yamlScalar('2026-10-04T09:25:28-04:00'), '2026-10-04T09:25:28-04:00');
  assert.equal(YAML.parse(`date: ${iso}`).date, iso);
  const loaded = jsyaml.load(`date: ${iso}`).date;
  assert.ok(loaded instanceof Date);
  assert.equal(loaded.toISOString(), new Date(iso).toISOString());
});

test('scalars that cannot be plain: block scalar (`>-` one line, `|-` several), read back identically', () => {
  const single = [
    'D6 — Recette : qui porte « UAT OK »', 'Oracle #783', 'a # b', 'fin:', '#784', '- liste', '-x', '? clé', ': deux', '& ancre', '* alias',
    '! tag', '| bloc', '> plié', '% directive', '@x', '`x`', '[x]', '{x}', '\'apostrophe', '"guillemets"', ',virgule',
    '1', '42', '2026-10-03', '-1', '+1', '.5', '1.0', '1e5', '0x1F', '0o17', '1_000', '1:20', 'null', 'Null', 'True', 'false', 'no', 'off',
    'yes', 'on', 'y', 'N', '~', '.inf', '-.Inf', '.nan', ' espace', 'fin ', '  deux espaces', 'tab\tici', '\tdébut tabulé',
  ];
  for (const value of single) {
    const out = yamlScalar(value, 2);
    assert.match(out, /^>2?-\n/, `${JSON.stringify(value)} -> ${out}`);
    assert.ok(noQuotes(out), out);
    for (const [name, read] of readBack(value)) assert.equal(read, value, `${name}: ${JSON.stringify(value)}`);
  }
  assert.equal(yamlScalar('D6 — Recette : qui porte « UAT OK »', 6), '>-\n      D6 — Recette : qui porte « UAT OK »');
  assert.equal(yamlScalar(' espace', 2), '>2-\n   espace');
  const multi = ['deux\nlignes', ' a\nb', 'a\n b', '\n x', 'x\n\n\ny', 'Titre : sous-titre\n# pas un commentaire'];
  for (const value of multi) {
    const out = yamlScalar(value, 6);
    assert.match(out, /^\|2?-\n/, out);
    for (const [name, read] of readBack(value)) assert.equal(read, value, `${name}: ${JSON.stringify(value)}`);
  }
});

test('normalisation: empty and blank values, line endings, characters a YAML stream cannot carry', () => {
  for (const [value, expected] of [['', ''], [' ', ''], ['x\n', 'x'], ['a\r\nb', 'a\nb'], ['a\rb', 'a\nb'], ['nul\u0000', 'nul'],
    ['sep\u2028', 'sep'], ['bom\ufeff', 'bom'], ['del\u007f', 'del'], ['bip\u0007 : x', 'bip : x'], ['a\n  \nb', 'a\n\nb']]) {
    assert.ok(noQuotes(yamlScalar(value)), yamlScalar(value));
    assert.ok(!/[\r\u0000\u2028\ufeff\u007f\u0007]/.test(yamlScalar(value)));
    for (const [name, read] of readBack(value)) assert.equal(read, expected, `${name}: ${JSON.stringify(value)}`);
  }
  assert.equal(yamlScalar(''), '>-');
});

test('commentaire: literal block, normalised, indented, never closes the Markdown fence', () => {
  assert.equal(yamlBlock('', 6), '|');
  assert.equal(yamlBlock('  \n\n', 6), '|');
  const text = 'Ligne 1 : "oui" # pas un commentaire\r\nl\'option b\n\n```\n- pas une liste';
  const out = yamlBlock(`\n${text}\n\n  `, 6);
  assert.equal(out, '|\n      Ligne 1 : "oui" # pas un commentaire\n      l\'option b\n\n      ```\n      - pas une liste');
  assert.equal(yamlBlock('  indenté\nsuite', 6), '|2\n        indenté\n      suite');
  assert.equal(yamlBlock('bip\u0007', 6), '|\n      bip');
  // Clip chomping: readers get the text with one final line break.
  for (const load of Object.values(READERS)) {
    assert.equal(load(`list:\n  - c: ${out}\n    next: 1\n`).list[0].c, `${text.replace(/\r\n/g, '\n')}\n`);
    assert.equal(load(`list:\n  - c: ${yamlBlock('  indenté\nsuite', 6)}\n`).list[0].c, '  indenté\nsuite\n');
    assert.equal(load(`list:\n  - c: ${yamlBlock('', 6)}\n    next: 1\n`).list[0].c, '');
  }
});

test('"Je suis" filter: Fabien decides all seven, Farid has none of his own, "toutes" keeps all', () => {
  assert.deepEqual(PEOPLE, ['Fabien', 'Farid']);
  const mine = person => decisionRecords(questions, {}, person, 'mine');
  assert.equal(mine('Fabien').length, 7);
  assert.ok(mine('Fabien').every(record => record.decide === 'Fabien' && record.role === 'decide'));
  // Farid is consulted (D2, D3) or informed: none of the decisions is his own.
  assert.equal(mine('Farid').length, 0);
  const all = decisionRecords(questions, {}, 'Farid', 'all');
  assert.equal(all.length, 7);
  assert.ok(all.every(record => record.role === null));
  assert.equal(all.find(record => record.id === 'D2').consulte, 'Farid');
  assert.equal(all.find(record => record.id === 'D1').consulte, 'Farid (informé)');
});

test('records: option id and label, statut, commentaire; unknown option rejected', () => {
  const state = { selections: { D2: 'C', D3: 'a', D5: 'b' }, comments: { D2: 'Brainstorm : oui' }, deferred: { D5: true } };
  const byId = Object.fromEntries(decisionRecords(questions, state, 'Fabien', 'all').map(record => [record.id, record]));
  assert.deepEqual(byId.D2, {
    id: 'D2', titre: 'Principe de correction de la collision', role: 'decide', decide: 'Fabien', consulte: 'Farid',
    option: 'C', option_libelle: 'C — Clé primaire (city_slug, id), arêtes rattachées à la ville, réparation depuis latest.json', statut: 'tranchee', commentaire: 'Brainstorm : oui',
  });
  assert.equal(byId.D5.statut, 'differee');
  assert.equal(byId.D5.option, 'b');
  assert.equal(byId.D1.statut, 'non_traitee');
  assert.equal(byId.D1.option, null);
  for (const record of Object.values(byId)) assert.ok(STATUSES.includes(record.statut));
  assert.throws(() => decisionRecords(questions, { selections: { D1: 'z' } }, 'Fabien', 'all'), /Unknown option z for D1/);
});

// The manifest built from the dossier (`make map`), with a page sha256 in place of the
// placeholder that portable.mjs replaces.
const realManifest = async () => {
  const { manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
  return { ...manifest, htmlSha256: '0b'.repeat(32) };
};

test('export block: fenced YAML without quotes, agreed header, coller_dans = the PR of this dossier', async () => {
  const manifest = await realManifest();
  assert.equal(manifest.title, 'Villes dont la base et le graphe stocké ne concordent plus : corriger le mélange de nœuds entre villes et remettre 226 villes en cohérence');
  const state = { selections: { D2: 'C', D3: 'a' }, comments: { D2: 'ligne 1\nligne 2' } };
  const now = new Date('2026-10-04T13:25:28Z');
  const { text, records } = exportBlock(manifest, state, 'Fabien', 'mine', now);
  assert.ok(!text.includes('"'), 'no double quote in the export');
  const lines = text.split('\n');
  assert.equal(lines[0], '```yaml');
  assert.equal(lines.at(-1), '```');
  assert.deepEqual(lines.slice(1, 9), [
    'dossier: >-', `  ${manifest.title}`, 'fichier: DOSSIER_DECISION_VILLES_ECART_2026-10-04.md',
    `version: 2026-10-04 · sha256:${'0b'.repeat(32)}`, 'decideur: Fabien', `date: ${isoWithOffset(now)}`,
    `coller_dans: ${DECISIONS_TARGET_URL}`, 'decisions:',
  ]);
  assert.equal(DECISIONS_TARGET_URL, 'https://github.com/rhanka/radar-immobilier/pull/815');
  assert.equal(records.length, 7);
  assert.equal(lines.filter(line => line.startsWith('  - id: ')).length, 7);
  const d2 = text.split('  - id: D2\n')[1].split('\n  - id: ')[0];
  assert.equal(d2, [
    '    titre: Principe de correction de la collision', '    role: decide', '    decide: Fabien', '    consulte: Farid',
    '    option: C', '    option_libelle: C — Clé primaire (city_slug, id), arêtes rattachées à la ville, réparation depuis latest.json', '    statut: tranchee',
    '    commentaire: |', '      ligne 1', '      ligne 2',
  ].join('\n'));
  // Farid: no own decision, an empty list after the header.
  assert.equal(exportBlock(manifest, state, 'Farid', 'mine', now).text.split('\n').at(-2), 'decisions: []');
  assert.equal(decisionsYaml({}, []).split('\n').at(-1), 'decisions: []');
});

test('round trip on the real dossier: yaml and js-yaml read back every header and record field', async () => {
  const manifest = await realManifest();
  const now = new Date('2026-10-04T13:25:28Z');
  // Every option of every decision in turn, a deferred one, and comments with YAML-active text.
  for (const pass of [0, 1, 2, 3]) {
    const selections = Object.fromEntries(questions.map(question => [question.key, question.options[pass % question.options.length].key]));
    delete selections.D1;
    const comments = { D2: 'Voir #812 : oui\n- pas une liste\n\n```', D6: '  retrait\n« l\'étiquette » : porte:x' };
    for (const person of PEOPLE) for (const scope of ['mine', 'all']) {
      const { text, records } = exportBlock(manifest, { selections, comments, deferred: { D5: true } }, person, scope, now);
      assert.ok(!text.includes('"'), 'no double quote in the export');
      const yaml = text.slice('```yaml\n'.length, -'\n```'.length);
      const expected = {
        dossier: manifest.title, fichier: 'DOSSIER_DECISION_VILLES_ECART_2026-10-04.md',
        version: `2026-10-04 · sha256:${'0b'.repeat(32)}`, decideur: person, date: isoWithOffset(now), coller_dans: DECISIONS_TARGET_URL,
        decisions: records.map(record => ({ ...record, commentaire: record.commentaire ? `${record.commentaire}\n` : '' })),
      };
      for (const [name, load] of Object.entries(READERS)) {
        const read = load(yaml);
        if (read.date instanceof Date) read.date = read.date.toISOString() === new Date(expected.date).toISOString() ? expected.date : read.date;
        assert.deepEqual(read, expected, `${name} ${person} ${scope} pass ${pass}`);
        assert.deepEqual(Object.keys(read), ['dossier', 'fichier', 'version', 'decideur', 'date', 'coller_dans', 'decisions']);
        if (records.length) assert.deepEqual(Object.keys(read.decisions[0]), ['id', 'titre', 'role', 'decide', 'consulte', 'option', 'option_libelle', 'statut', 'commentaire']);
      }
    }
  }
});

test('the JSON pack stays available internally, for the backend connection', () => {
  const pack = responsePack({ dossier: 'x', dossierHash: 'h', artifactInputHash: 'i' }, { D2: 'C' });
  assert.equal(pack.responses.length, 7);
  assert.equal(pack.responses.find(response => response.key === 'D2').selection, 'C');
});
