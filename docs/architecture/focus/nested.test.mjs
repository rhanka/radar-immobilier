import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sceneFor } from './scenes.js';
const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

test('every complete diagram shows all leaves, all nested boxes and all exact edges together', () => {
  for (const graph of graphs) {
    const scene = sceneFor(graph), byId = new Map(scene.nodes.map(n => [n.id, n]));
    assert.equal(scene.nodes.length, graph.nodes.length + graph.groups.length, graph.id);
    assert.equal(scene.edges.length, graph.edges.length, graph.id);
    for (const item of [...graph.groups, ...graph.nodes]) {
      const node = byId.get(item.id);
      assert.ok(node, `Missing simultaneous node ${item.id}`);
      assert.equal(node.parentId ?? null, item.parent);
      if (item.parent) {
        const parent = byId.get(item.parent);
        assert.ok(scene.nodes.indexOf(parent) < scene.nodes.indexOf(node));
        assert.ok(node.position.x >= 0 && node.position.y >= 56);
        assert.ok(node.position.x + node.width <= parent.width);
        assert.ok(node.position.y + node.height <= parent.height);
      }
    }
    for (const edge of graph.edges) {
      const actual = scene.edges.find(e => e.id === edge.id);
      assert.equal(actual.source, edge.source); assert.equal(actual.target, edge.target);
      assert.equal(actual.label, edge.label);
    }
  }
});
