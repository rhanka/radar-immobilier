import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARD, sceneFor } from '../../../../architecture/focus/scenes.js';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';

const { graphs, decisionSections, annexes, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

test('deux scènes canoniques, dans l’ordre', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['way-of-working', 'iteration-15-jours']);
  assert.equal(manifest.graphs.length, 2);
});

test('les sept sections du dossier et son annexe A sont présentes', () => {
  assert.equal(decisionSections.length, 7);
  assert.ok(annexes.some(section => section.heading.startsWith('Annexe A')));
  // L'annexe B ne passe pas en prose : c'est la source Mermaid des deux scènes.
  assert.ok(!annexes.some(section => section.heading.startsWith('Annexe B')));
});

test('les 9 colonnes owner sont des conteneurs et portent leurs cinq cartes', () => {
  const wow = graphs.find(graph => graph.id === 'way-of-working');
  assert.equal(wow.groups.length, 9);
  const roles = ['Colonne · owner', 'Critère · entrée', 'Critère · sortie', 'Qui · déplace', 'Artefact · attendu'];
  for (const group of wow.groups) {
    const children = wow.nodes.filter(node => node.parent === group.id);
    assert.equal(children.length, 5, `${group.id} ne porte pas cinq cartes`);
    assert.deepEqual([...children.map(node => node.metadata.role)].sort(), [...roles].sort());
  }
  assert.equal(wow.groups.at(-1).label, '9 · En prod (clos)');
  assert.equal(wow.nodes.length, 45);
});

test('les items de l’itération sont dans leur colonne de départ', () => {
  const iteration = graphs.find(graph => graph.id === 'iteration-15-jours');
  const parentOf = code => iteration.nodes.find(node => node.metadata.code === code)?.parent;
  assert.equal(parentOf('O1a'), 'BDEV');
  assert.equal(parentOf('T12'), 'BDEV');
  assert.equal(parentOf('O1b'), 'BPROD');
  // §4.2 échelonne les designs : O2, O7, O3, O5, O6 en S1 ; O4 et O8 entrent en S2.
  for (const code of ['O2', 'O7', 'O3', 'O5', 'O6']) assert.equal(parentOf(code), 'BDESIGN');
  for (const code of ['O4', 'O8']) assert.equal(parentOf(code), 'BDESIGN2');
  const codes = new Set(iteration.nodes.map(node => node.metadata.code));
  for (const code of ['O1a', 'O1b', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'T12']) assert.ok(codes.has(code), `${code} manquant`);
});

test('les dépendances demandées sont des arêtes libellées', () => {
  const iteration = graphs.find(graph => graph.id === 'iteration-15-jours');
  const has = (source, target) => iteration.edges.some(edge => edge.source === source && edge.target === target && edge.label);
  assert.ok(has('J0_PR', 'O2'));
  assert.ok(has('O2', 'O1B'));
  assert.ok(has('O3', 'O4'));
  assert.ok(has('O6', 'O8'));
  assert.ok(has('J0_ROLE', 'O7'));
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
