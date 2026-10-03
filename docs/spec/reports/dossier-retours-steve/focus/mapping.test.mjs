import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARD } from '../../../../architecture/focus/scenes.js';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';
import { questions } from './choices.js';

const { graphs, decisionSections, annexes, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

test('cinq scènes canoniques, dans l’ordre', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['criteres-steve', 'modele-donnees', 'flux-import-oracle', 'architecture-ui', 'affichage-abc']);
  assert.equal(manifest.graphs.length, 5);
});

test('les douze sections et l’annexe de convergence sont présentes ; l’annexe B ne passe pas en prose', () => {
  assert.equal(decisionSections.length, 12);
  assert.match(decisionSections[0].heading, /^1\. Intention du dossier, objectifs de l'owner/);
  assert.match(decisionSections[1].heading, /^2\. Ce que veut Steve/);
  assert.deepEqual(annexes.map(section => section.heading), ['Annexe A — Convergence entre les deux auteurs']);
  for (const section of [...decisionSections, ...annexes]) assert.ok(!section.markdown.includes('```mermaid'), section.heading);
});

test('chaque carte respecte le gabarit A’ et ses champs', () => {
  assert.deepEqual(CARD.A, { width: 460, height: 200 });
  for (const graph of graphs) for (const node of graph.nodes) {
    const meta = node.metadata;
    assert.equal(meta.card, 'A', `${graph.id}/${node.id}`);
    assert.ok(meta.code && meta.role && meta.name && meta.detail, `${graph.id}/${node.id}`);
    assert.ok(roleIsShort(meta.role), `${graph.id}/${node.id} rôle trop long`);
    assert.ok(meta.name.length <= 28 && meta.detail.length <= 30, `${graph.id}/${node.id} texte trop long`);
  }
});

test('le modèle de données porte les tables proposées et la publication conforme', () => {
  const model = graphs.find(graph => graph.id === 'modele-donnees');
  const names = model.nodes.map(node => node.metadata.name);
  for (const name of ['annotation_sources', 'annotation_raw_rows', 'annotation_assessments', 'annotation_anchors', 'oracle_releases', 'prospect_notes'])
    assert.ok(names.includes(name), name);
  assert.equal(model.groups.length, 5);
  // Seule prospect_notes existe déjà : toute autre table est une proposition.
  for (const node of model.nodes) assert.equal(node.metadata.evidenceClass, node.id === 'PN' ? 'observed' : 'declared', node.id);
});

test('les chiffres des cartes sont ceux du dossier', () => {
  const card = (sceneId, id) => graphs.find(graph => graph.id === sceneId).nodes.find(node => node.id === id).metadata;
  assert.match(card('flux-import-oracle', 'XLS').detail, /7 feuilles · 433 lignes/);
  assert.match(card('architecture-ui', 'GCB').detail, /2 761 lignes/);
  assert.match(card('architecture-ui', 'DS').detail, /39 sur 69/);
  assert.match(card('architecture-ui', 'COL').detail, /0 sur 3/);
  assert.match(card('modele-donnees', 'COD').detail, /28 codes · 24 employés/);
});

test('A/B/C : B observé, C proposé, trois états de C', () => {
  const abc = graphs.find(graph => graph.id === 'affichage-abc');
  const byId = Object.fromEntries(abc.nodes.map(node => [node.id, node]));
  assert.equal(byId.PB.metadata.evidenceClass, 'observed');
  assert.equal(byId.PC.metadata.evidenceClass, 'declared');
  assert.deepEqual(['CONF', 'INS', 'EXC'].map(id => byId[id].parent), ['C1', 'C1', 'C1']);
});

test('seize décisions D1 à D16, recommandation connue sauf le point ouvert D9', () => {
  assert.deepEqual(questions.map(question => question.key), Array.from({ length: 16 }, (_, index) => `D${index + 1}`));
  for (const question of questions) {
    if (question.key === 'D9') { assert.equal(question.recommended, null); continue; }
    assert.ok(question.options.some(option => option.key === question.recommended), question.key);
  }
});

test('critères de Steve : trois critères et leur couverture', () => {
  const k = graphs.find(graph => graph.id === 'criteres-steve');
  const byId = Object.fromEntries(k.nodes.map(node => [node.id, node]));
  assert.deepEqual(k.groups.map(group => group.id), ['K1', 'K2', 'K3', 'KX', 'EF']);
  assert.deepEqual(['R1C', 'R2C', 'R3C', 'RXC'].map(id => byId[id].metadata.role), ['Radar · partiel', 'Radar · absent', 'Radar · absent', 'Radar · partiel']);
  assert.match(byId.NOI.metadata.name, /24 \/ 73/);
  assert.match(byId.REC.metadata.name, /34 \/ 40/);
});
