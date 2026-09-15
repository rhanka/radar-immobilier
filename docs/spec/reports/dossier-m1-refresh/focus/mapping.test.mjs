import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARD, sceneFor } from '../../../../architecture/focus/scenes.js';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';
import { questions } from './choices.js';

const { graphs, decisionSections, annexes, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

test('deux scènes canoniques, dans l’ordre', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['chaine-de-mesure', 'resultats-v4-v100']);
  assert.equal(manifest.graphs.length, 2);
});

test('les sept sections du dossier et son annexe glossaire sont présentes', () => {
  assert.equal(decisionSections.length, 7);
  assert.ok(annexes.some(section => section.heading.startsWith('Annexe — glossaire')));
  // L'annexe B ne passe pas en prose : c'est la source Mermaid des deux scènes.
  assert.ok(!annexes.some(section => section.heading.startsWith('Annexe B')));
});

test('les six couches de validation sont des conteneurs et portent leurs trois cartes', () => {
  const chain = graphs.find(graph => graph.id === 'chaine-de-mesure');
  assert.equal(chain.groups.length, 6);
  assert.deepEqual(chain.groups.map(group => group.label), ['1 · Transport', '2 · JSON normalisé',
    '3 · Structure', '4 · Profil', '5 · Provenance', '6 · Accepté']);
  const roles = ['Vérifié · porte', 'Refus · v100', 'Exemple · réel'];
  for (const group of chain.groups) {
    const children = chain.nodes.filter(node => node.parent === group.id);
    assert.equal(children.length, 3, `${group.id} ne porte pas trois cartes`);
    assert.deepEqual([...children.map(node => node.metadata.role)].sort(), [...roles].sort());
  }
  assert.equal(chain.nodes.length, 18);
  // Les effectifs de refus v100 mesurés : 7 au profil, 6 à la provenance, 13 au total.
  const refusal = code => chain.nodes.find(node => node.metadata.code === code).metadata;
  assert.match(refusal('R-4').name, /7 refus/);
  assert.match(refusal('R-4').detail, /evidence_ref 5 · INFERRED 2/);
  assert.match(refusal('R-5').name, /6 refus/);
  assert.match(refusal('R-5').detail, /32 refusés/);
  assert.match(refusal('R-6').name, /13 PV sur 100 refusés/);
});

test('la chronologie des campagnes et les quatre options sont des cartes', () => {
  const results = graphs.find(graph => graph.id === 'resultats-v4-v100');
  const codes = results.nodes.map(node => node.metadata.code);
  for (const code of ['v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12-a', 'v12-b',
    'v13-a', 'v13-b', 'v14', 'v15', 'v16', 'v100']) assert.ok(codes.includes(code), `${code} manquant`);
  assert.equal(results.groups.length, 6);
  const parentOf = code => results.nodes.find(node => node.metadata.code === code)?.parent;
  for (const code of ['OPT-A', 'OPT-B', 'OPT-C', 'OPT-D']) assert.equal(parentOf(code), 'E6');
  assert.equal(parentOf('v100'), 'E5');
  const detailOf = code => results.nodes.find(node => node.metadata.code === code).metadata.detail;
  // Les plafonds mesurés de §6, dans l'ordre : 87 puis 93 puis 96 %.
  assert.equal(detailOf('OPT-A'), 'plafond mesuré 87 %');
  assert.equal(detailOf('OPT-B'), 'plafond mesuré 87 → 93 %');
  assert.equal(detailOf('OPT-C'), 'plafond mesuré 87 → 96 %');
  assert.match(detailOf('OPT-D'), /variance/);
});

test('la chronologie relie les époques et débouche sur les options', () => {
  const results = graphs.find(graph => graph.id === 'resultats-v4-v100');
  const has = (source, target) => results.edges.some(edge => edge.source === source && edge.target === target && edge.label);
  assert.ok(has('v6', 'v7'));
  assert.ok(has('v11', 'v12A'));
  assert.ok(has('v13A', 'v14'));
  assert.ok(has('v16', 'v100'));
  assert.ok(has('v100', 'OPTA'));
});

test('le choix de §7 porte les quatre options du dossier', () => {
  assert.equal(questions.length, 1);
  assert.equal(questions[0].mode, 'single');
  assert.deepEqual(questions[0].options.map(option => option.key), ['A', 'B_PRIME', 'C_PRIME', 'D_PRIME']);
});

test('gabarit unique A’ 460 x 200 et rôles « deux par deux »', () => {
  assert.deepEqual(CARD.A, { width: 460, height: 200 });
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      assert.equal(node.metadata.card, 'A');
      assert.ok(roleIsShort(node.metadata.role), `${graph.id}/${node.id}: ${node.metadata.role}`);
      assert.ok(node.metadata.code && node.metadata.name && node.metadata.detail);
      assert.ok(!node.metadata.name.includes(node.metadata.code));
    }
    for (const group of graph.groups) assert.equal(group.metadata.card, 'box');
  }
});

test('la géométrie Dagre LR place tout sans chevauchement de cartes', () => {
  for (const graph of graphs) {
    const scene = sceneFor(graph);
    assert.ok(scene.canvas.width > 0 && scene.canvas.height > 0);
    const leaves = scene.absoluteNodes.filter(node => !node.data.group);
    assert.equal(leaves.length, graph.nodes.length);
    for (let left = 0; left < leaves.length; left++) for (let right = left + 1; right < leaves.length; right++) {
      const a = leaves[left], b = leaves[right];
      const overlap = a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x
        && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
      assert.ok(!overlap, `${graph.id}: ${a.id} et ${b.id} se chevauchent`);
    }
    for (const edge of scene.edges) if (edge.label) assert.ok(edge.data.labelPoint, `${graph.id}: ${edge.id} sans libellé placé`);
  }
});
