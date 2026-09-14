import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sceneFor, CARD } from './scenes.js';

const { graphs, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const order = ['hosting-july-2026', 'hosting-august-20260810', 'hosting-today-20260913', 'pipeline-before-20260810', 'pipeline-after-20260913'];

test('five canonical Mermaid graphs map bijectively to five native scenes', () => {
  assert.deepEqual(graphs.map(graph => graph.id), order);
  assert.deepEqual(manifest.graphOrder, order);
  assert.equal(new Set(graphs.map(graph => graph.sceneHash)).size, 5);
  for (const graph of graphs) {
    const scene = sceneFor(graph);
    // Baseline orientation is LR, so every scene stays wider than tall. v11: an
    // annex page prints the whole scene on one A4 portrait page, fitted to the
    // page width exactly as the body figure is. Nothing is split any more, so
    // the only geometric requirement is that the width — not the height — sets
    // the scale, otherwise the annex would show the scene smaller than the
    // half-page figure it is supposed to complete.
    assert.ok(scene.canvas.width > scene.canvas.height,
      `${graph.id}: ${scene.canvas.width}x${scene.canvas.height} is not landscape`);
    const annexImageWidthPx = (210 - 2 * 10) * 96 / 25.4 - 2;
    const annexImageHeightPx = (297 - 2 * 10) * 96 / 25.4 - 54 - 168 - 2;
    assert.ok(scene.canvas.width / scene.canvas.height >= annexImageWidthPx / annexImageHeightPx,
      `${graph.id}: ${scene.canvas.width}x${scene.canvas.height} would be height-bound on a portrait annex page`);
    for (const node of scene.nodes.filter(item => !item.data.group)) {
      assert.deepEqual({ width: node.width, height: node.height }, CARD[node.data.card],
        `${graph.id}/${node.id}: card box differs from template ${node.data.card}`);
    }
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
    assert.deepEqual(graph.projection.edges.map(edge => edge.id), graph.edges.map(edge => edge.id).sort((a, b) => a.localeCompare(b)));
  }
});
