import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARD } from '../../../../architecture/focus/scenes.js';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';
import { questions } from './choices.js';

const { graphs, decisionSections, annexes, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const markdown = await readFile('../DOSSIER_DECISION_ROLES_IMMO_2026-10-03.md', 'utf8');

test('cinq scènes canoniques, dans l’ordre', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['roles-perimetres', 'matrice-decide-valide', 'circuit-validation', 'deux-branches-d10', 'immo-vs-geo']);
  assert.equal(manifest.graphs.length, 5);
});

test('les douze sections et l’annexe de consensus sont présentes ; l’annexe B ne passe pas en prose', () => {
  assert.equal(decisionSections.length, 12);
  assert.match(decisionSections[0].heading, /^1\. Intention du dossier, objectifs de l'owner/);
  assert.match(decisionSections[1].heading, /^2\. Destinataires et rôles/);
  assert.match(decisionSections[2].heading, /^3\. Synthèse et décisions demandées/);
  assert.ok(annexes.some(section => section.heading.startsWith('Annexe A — Consensus Fable / Astra')));
  for (const section of [...decisionSections, ...annexes]) assert.ok(!section.markdown.includes('```mermaid'), section.heading);
});

test('chaque carte respecte le gabarit A’ et ses champs', () => {
  assert.deepEqual(CARD.A, { width: 460, height: 200 });
  for (const graph of graphs) for (const node of graph.nodes) {
    const meta = node.metadata;
    assert.equal(meta.card, 'A', `${graph.id}/${node.id}`);
    assert.ok(meta.code && meta.role && meta.name && meta.detail, `${graph.id}/${node.id}`);
    assert.ok(roleIsShort(meta.role), `${graph.id}/${node.id} rôle trop long`);
    assert.ok(meta.role.length <= 20 && meta.name.length <= 28 && meta.detail.length <= 30, `${graph.id}/${node.id} texte trop long`);
  }
});

test('rôles et périmètres : quatre personnes, un seul PRINCIPAL, trois humains sans rôle h2a', () => {
  const scene = graphs.find(graph => graph.id === 'roles-perimetres');
  const byId = Object.fromEntries(scene.nodes.map(node => [node.id, node]));
  assert.deepEqual(scene.groups.map(group => group.id), ['PE', 'FO', 'H2', 'PD']);
  assert.deepEqual(['FAB', 'FAR', 'MAT', 'STE'].map(id => byId[id].metadata.name), ['Fabien', 'Farid', 'Mathieu', 'Steve']);
  assert.match(byId.PRI.metadata.detail, /repo:radar-immobilier/);
  for (const id of ['FAR', 'MAT', 'STE']) assert.match(byId[id].metadata.detail, /sans rôle h2a/, id);
  // L'option « Steve PRINCIPAL » et le droit de Mathieu sont ouverts, pas acquis.
  const open = scene.edges.filter(edge => edge.metadata.evidenceClass === 'unknown').map(edge => `${edge.source}>${edge.target}`).sort();
  assert.deepEqual(open, ['FCL>PRI', 'FPM>DPROD']);
});

test('matrice : quatre domaines à double validation, déclencheurs conditionnels en pointillé', () => {
  const scene = graphs.find(graph => graph.id === 'matrice-decide-valide');
  const toVPO = scene.edges.filter(edge => edge.target === 'VPO').map(edge => edge.source).sort();
  const toVAI = scene.edges.filter(edge => edge.target === 'VAI').map(edge => edge.source).sort();
  assert.deepEqual(toVAI, ['ACC', 'ITE', 'REL', 'SEM']);
  for (const id of ['ACC', 'ITE', 'REL', 'SEM']) assert.ok(toVPO.includes(id), id);
  assert.deepEqual(scene.edges.filter(edge => edge.dashed).map(edge => edge.source).sort(), ['ARC', 'SEC']);
  const byId = Object.fromEntries(scene.nodes.map(node => [node.id, node]));
  assert.equal(byId.ORI.metadata.evidenceClass, 'unknown');
  assert.equal(scene.nodes.filter(node => node.metadata.kind === 'domain').length, 13); // 15 lignes au §6, tech.architecture, ai et data-model fusionnées en une carte
});

test('circuit : PO avant AI Builder, garde-fous en pointillé vers la décision ou le GO', () => {
  const scene = graphs.find(graph => graph.id === 'circuit-validation');
  const chain = ['PREP>BLOC', 'BLOC>DEC', 'DEC>VPO', 'VPO>VAI', 'VAI>GO', 'GO>EXE'];
  const solid = scene.edges.filter(edge => !edge.dashed).map(edge => `${edge.source}>${edge.target}`);
  for (const link of chain) assert.ok(solid.includes(link), link);
  assert.deepEqual(scene.edges.filter(edge => edge.dashed).map(edge => edge.source).sort(), ['CONS', 'DEL', 'REV', 'RLY', 'URG']);
});

test('deux branches de D10 : même affectation sous A et sous B', () => {
  const scene = graphs.find(graph => graph.id === 'deux-branches-d10');
  const same = scene.edges.filter(edge => edge.label === 'même affectation').map(edge => `${edge.source}>${edge.target}`).sort();
  assert.deepEqual(same, ['A3>E1', 'B3>E1']);
  assert.deepEqual(scene.groups.map(group => group.id), ['Q', 'BA', 'BB', 'EF', 'DF']);
});

test('immo et geo : deux validations à immo, une seule personne à geo', () => {
  const scene = graphs.find(graph => graph.id === 'immo-vs-geo');
  const byId = Object.fromEntries(scene.nodes.map(node => [node.id, node]));
  assert.deepEqual(byId.FAB.metadata.repo, ['radar-immobilier']);
  assert.deepEqual(byId.GFAB.metadata.repo, ['geo']);
  assert.match(byId.X1.metadata.detail, /2 validations/);
  assert.match(byId.X2.metadata.detail, /1 seul valideur/);
  assert.equal(byId.GK.metadata.evidenceClass, 'external');
});

test('dix-huit décisions D1 à D18, chacune avec un décideur, une recommandation connue ; 7 à Farid, 11 à Fabien', () => {
  assert.deepEqual(questions.map(question => question.key), Array.from({ length: 18 }, (_, index) => `D${index + 1}`));
  for (const question of questions) {
    assert.ok(['Farid', 'Fabien'].includes(question.decides), question.key);
    assert.ok(question.options.some(option => option.key === question.recommended), question.key);
  }
  assert.deepEqual(questions.filter(question => question.decides === 'Farid').map(question => question.key), ['D3', 'D4', 'D6', 'D7', 'D11', 'D12', 'D17']);
  assert.equal(questions.filter(question => question.decides === 'Fabien').length, 11);
});

test('le Markdown porte « Décide : » pour chaque décision du §10 et les deux tableaux séparés', () => {
  const options = markdown.split('\n## 10. Options et recommandation')[1].split('\n## 11.')[0];
  const heads = [...options.matchAll(/^### (D\d+) — /gm)].map(match => match[1]);
  assert.deepEqual(heads, questions.map(question => question.key));
  assert.equal([...options.matchAll(/^\*\*Décide : /gm)].length, 18);
  assert.ok(markdown.includes('### Décisions de Farid') && markdown.includes('### Décisions de Fabien'));
  for (const question of questions) {
    const block = options.split(`### ${question.key} — `)[1].split('\n### ')[0];
    assert.ok(block.includes(`**Décide : ${question.decides}`), `${question.key} décideur`);
  }
});

test('le vocabulaire proscrit est absent du dossier et de la page', async () => {
  const sources = [markdown, await readFile('choices.js', 'utf8'), await readFile('App.svelte', 'utf8'), await readFile('Scenes.svelte', 'utf8')];
  for (const source of sources) assert.ok(!/honn[êe]te/i.test(source));
});
