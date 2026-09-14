import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sceneFor } from './scenes.js';

const { graphs, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const order = ['storage-before-20260809', 'storage-after-20260913', 'refresh-before-20260809', 'refresh-after-20260913'];

test('four canonical Mermaid graphs map bijectively to four native scenes', () => {
  assert.deepEqual(graphs.map(graph => graph.id), order);
  assert.deepEqual(manifest.graphOrder, order);
  assert.equal(new Set(graphs.map(graph => graph.sceneHash)).size, 4);
  for (const graph of graphs) {
    const scene = sceneFor(graph);
    assert.equal(scene.nodes.length, graph.nodes.length + graph.groups.length);
    assert.equal(scene.edges.length, graph.edges.length);
    assert.deepEqual(new Set(scene.nodes.map(node => node.id)), new Set([...graph.nodes, ...graph.groups].map(node => node.id)));
    assert.deepEqual(new Set(scene.edges.map(edge => edge.id)), new Set(graph.edges.map(edge => edge.id)));
    for (const node of scene.nodes) {
      assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
      const source = [...graph.nodes, ...graph.groups].find(item => item.id === node.id);
      assert.equal(node.parentId ?? null, source.parent);
      assert.equal(node.data.evidenceClass, source.metadata.evidenceClass);
      assert.equal(node.data.runtimeState, source.metadata.runtimeState);
      if (node.parentId) {
        const parent = scene.nodes.find(item => item.id === node.parentId);
        assert.ok(node.position.x >= 0 && node.position.y >= 0, `${graph.id}/${node.id}: negative child position`);
        assert.ok(node.position.x + node.width <= parent.width && node.position.y + node.height <= parent.height,
          `${graph.id}/${node.id}: child exceeds ${node.parentId}`);
      }
    }
    for (const edge of scene.edges) {
      const source = graph.edges.find(item => item.id === edge.id);
      assert.equal(edge.source, source.source);
      assert.equal(edge.target, source.target);
      assert.equal(edge.label, source.label);
      assert.equal(edge.data.evidenceClass, source.metadata.evidenceClass);
      assert.equal(edge.data.runtimeState, source.metadata.runtimeState);
    }
    const leaves = scene.absoluteNodes.filter(node => !node.data.group);
    for (let left = 0; left < leaves.length; left++) for (let right = left + 1; right < leaves.length; right++) {
      const a = leaves[left], b = leaves[right];
      const overlaps = a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x
        && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
      assert.equal(overlaps, false, `${graph.id}: overlapping ${a.id}/${b.id} ${JSON.stringify([a.position, b.position])}`);
    }
    for (const group of scene.nodes.filter(node => node.data.group)) {
      const children = scene.nodes.filter(node => node.parentId === group.id);
      assert.ok(children.length > 0, `${graph.id}/${group.id}: empty group`);
      const rightSlack = group.width - Math.max(...children.map(node => node.position.x + node.width));
      const bottomSlack = group.height - Math.max(...children.map(node => node.position.y + node.height));
      assert.ok(rightSlack <= 24 && bottomSlack <= 24, `${graph.id}/${group.id}: trailing slack ${rightSlack}/${bottomSlack}`);
    }
  }
});

test('canonical projection retains exact identity, containment and relationships', () => {
  for (const graph of graphs) {
    const projectedNodes = graph.projection.nodes.map(({ id, parentId, evidenceClass, runtimeState, repo }) => ({ id, parentId, evidenceClass, runtimeState, repo }));
    const expectedNodes = [...graph.nodes, ...graph.groups].map(item => ({ id: item.id, parentId: item.parent,
      evidenceClass: item.metadata.evidenceClass, runtimeState: item.metadata.runtimeState, repo: item.metadata.repo })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(projectedNodes, expectedNodes);
    assert.deepEqual(graph.projection.edges.map(edge => edge.id), graph.edges.map(edge => edge.id).sort());
  }
});
