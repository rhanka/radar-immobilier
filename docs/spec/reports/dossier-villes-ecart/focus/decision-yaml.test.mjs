import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yamlScalar, yamlBlock, isoWithOffset, decisionRecords, decisionsYaml, STATUSES } from './decision-yaml.js';
import { questions, exportBlock, responsePack, PEOPLE, DECISIONS_TARGET_URL } from './choices.js';

// Reads back what the emitter writes, without a YAML dependency, for the subset it
// emits: plain scalars, `null`, folded `>-` (one line) and literal `|`, `|-` blocks,
// with an optional indentation indicator.
function readValue(lines, start, head, indent) {
  const block = head.match(/^([>|])(\d?)(-?)$/);
  if (!block) return { value: head === 'null' ? null : head, next: start };
  const [, style, indicator, strip] = block;
  const body = [];
  let index = start;
  while (index < lines.length && (lines[index] === '' || lines[index].startsWith(' '.repeat(indent)))) body.push(lines[index++]);
  while (body.length && body.at(-1) === '') { body.pop(); index--; }
  const content = body.map(line => line.slice(indent));
  if (indicator) assert.equal(Number(indicator), 2);
  let value = style === '|' ? content.join('\n') : content.join(' ');
  if (!strip && value) value += '\n';
  return { value, next: index };
}
function readYaml(text) {
  const lines = text.split('\n');
  const header = {}, decisions = [];
  let index = 0, current = null;
  while (index < lines.length) {
    const line = lines[index++];
    if (line === '' || line === 'decisions:' || line === 'decisions: []') continue;
    const item = line.match(/^ {2}- (\w+): ?(.*)$/), field = line.match(/^ {4}(\w+): ?(.*)$/), top = line.match(/^(\w+): ?(.*)$/);
    const [, key, head] = item ?? field ?? top ?? [];
    if (!key) throw Error(`unreadable line ${JSON.stringify(line)}`);
    const { value, next } = readValue(lines, index, head, top && !item && !field ? 2 : 6);
    index = next;
    if (item) { current = {}; decisions.push(current); }
    (top && !item && !field ? header : current)[key] = value;
  }
  return { header, decisions };
}
const scalarRoundTrip = value => readYaml(`k: ${yamlScalar(value, 2)}`).header.k;

test('scalars: never quoted; plain when YAML reads the same string back, otherwise a block', () => {
  const plain = ['Fabien', 'D2', 'Farid (informé)', '(a) Laisser en l’état', 'C — Clé primaire (city_slug, id)', '—', 'tranchee',
    'https://github.com/rhanka/radar-immobilier/pull/812', 'a:b', 'l\'option', 'dit "oui"', 'C#'];
  for (const value of plain) assert.equal(yamlScalar(value), value, value);
  const blocks = [
    'D3 — Priorité : mesure d’attente', '#812', 'a # b', '- liste', '? clé', '& ancre', '* alias', '! tag', '| bloc', '> plié', '% directive',
    '@x', '`x`', '[x]', '{x}', '"cité"', '\'cité\'', '1', '2026-10-04', '2026-10-04 · sha256:00', '-1', '.5', 'null', 'True', 'no', 'off', '~', '.inf',
    ' espace', 'fin ', 'tab\tici', 'fin:',
  ];
  for (const value of blocks) {
    const out = yamlScalar(value, 2);
    assert.match(out, /^>2?-\n {2}/, `${JSON.stringify(value)} -> ${out}`);
    assert.equal(scalarRoundTrip(value), value, `round trip of ${JSON.stringify(value)}`);
  }
  assert.equal(yamlScalar('deux\nlignes', 6), '|-\n      deux\n      lignes');
  assert.equal(readYaml(`k: ${yamlScalar('deux\nlignes', 2)}`).header.k, 'deux\nlignes');
  assert.equal(yamlScalar(''), '>-\n');
  assert.equal(scalarRoundTrip(''), '');
  assert.equal(yamlScalar('nul\u0000'), 'nul');
  assert.equal(yamlScalar(null), 'null');
  assert.equal(yamlScalar(undefined), 'null');
  for (const value of [...plain, ...blocks]) assert.ok(!/^["']/.test(yamlScalar(value)), `quoted output for ${value}`);
});

test('commentaire: literal block, normalised, indented, never closes the Markdown fence', () => {
  assert.equal(yamlBlock('', 6), '|');
  assert.equal(yamlBlock('  \n\n', 6), '|');
  const text = 'Ligne 1 : "oui" # pas un commentaire\r\nl\'option b\n\n```\n- pas une liste';
  const out = yamlBlock(`\n${text}\n\n  `, 6);
  assert.equal(out, '|\n      Ligne 1 : "oui" # pas un commentaire\n      l\'option b\n\n      ```\n      - pas une liste');
  assert.equal(yamlBlock('  indenté\nsuite', 6), '|2\n        indenté\n      suite');
  assert.equal(yamlBlock('bip\u0007', 6), '|\n      bip');
});

test('date: ISO-8601 with an explicit UTC offset', () => {
  assert.match(isoWithOffset(new Date('2026-10-04T12:34:56Z')), /^2026-10-0[45]T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('"Je suis" filter: Fabien decides all seven, Farid has none of his own, "toutes" keeps all', () => {
  assert.deepEqual(PEOPLE, ['Fabien', 'Farid']);
  const mine = person => decisionRecords(questions, {}, person, 'mine');
  assert.equal(mine('Fabien').length, 7);
  assert.ok(mine('Fabien').every(record => record.decide === 'Fabien' && record.role === 'decide'));
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
  assert.equal(byId.D1.statut, 'non_traitee');
  assert.equal(byId.D1.option, null);
  for (const record of Object.values(byId)) assert.ok(STATUSES.includes(record.statut));
  assert.throws(() => decisionRecords(questions, { selections: { D1: 'z' } }, 'Fabien', 'all'), /Unknown option z for D1/);
});

test('export block: fenced YAML, agreed header, no quotes, reads back exactly', () => {
  const manifest = { title: 'Villes dont la base et le graphe stocké ne concordent plus : corriger le mélange de nœuds entre villes', htmlSha256: 'ab'.repeat(32),
    dossier: 'docs/spec/reports/dossier-villes-ecart/DOSSIER_DECISION_VILLES_ECART_2026-10-04.md' };
  const state = { selections: { D2: 'C', D1: 'a' }, comments: { D2: 'ligne 1\nligne 2 : "oui"' } };
  const now = new Date('2026-10-04T12:00:00Z');
  const { text, records } = exportBlock(manifest, state, 'Fabien', 'mine', now);
  const lines = text.split('\n');
  assert.equal(lines[0], '```yaml');
  assert.equal(lines.at(-1), '```');
  assert.ok(!/^\s*(- )?\w+: ["']/m.test(text), 'no quoted scalar');
  const yaml = lines.slice(1, -1).join('\n');
  const { header, decisions } = readYaml(yaml);
  assert.deepEqual(Object.keys(header), ['dossier', 'fichier', 'version', 'decideur', 'date', 'coller_dans']);
  assert.equal(header.dossier, manifest.title);
  assert.equal(lines[1], 'dossier: >-');
  assert.equal(header.fichier, 'DOSSIER_DECISION_VILLES_ECART_2026-10-04.md');
  assert.equal(header.version, `2026-10-04 · sha256:${'ab'.repeat(32)}`);
  assert.equal(header.decideur, 'Fabien');
  assert.equal(header.date, isoWithOffset(now));
  assert.equal(header.coller_dans, DECISIONS_TARGET_URL);
  assert.ok(text.includes(`\ncoller_dans: ${DECISIONS_TARGET_URL}\n`), 'URL stays a plain scalar');
  assert.match(DECISIONS_TARGET_URL, /^https:\/\/github\.com\/rhanka\/radar-immobilier\/pull\/\d+$/);
  assert.equal(records.length, 7);
  assert.equal(decisions.length, 7);
  const d2 = decisions.find(decision => decision.id === 'D2');
  assert.deepEqual(d2, { id: 'D2', titre: 'Principe de correction de la collision', role: 'decide', decide: 'Fabien', consulte: 'Farid',
    option: 'C', option_libelle: 'C — Clé primaire (city_slug, id), arêtes rattachées à la ville, réparation depuis latest.json',
    statut: 'tranchee', commentaire: 'ligne 1\nligne 2 : "oui"\n' });
  assert.ok(text.includes('    commentaire: |\n      ligne 1\n      ligne 2 : "oui"'));
  assert.equal(decisions.find(decision => decision.id === 'D7').option, null);
  assert.equal(decisionsYaml({}, []).split('\n').at(-1), 'decisions: []');
});

test('the JSON pack stays available internally, for the backend connection', () => {
  const pack = responsePack({ dossier: 'x', dossierHash: 'h', artifactInputHash: 'i' }, { D2: 'C' });
  assert.equal(pack.responses.length, 7);
  assert.equal(pack.responses.find(response => response.key === 'D2').selection, 'C');
});
