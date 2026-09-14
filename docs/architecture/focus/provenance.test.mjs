import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { metadataFor } from './scene-metadata.js';

const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const evidence = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const runtime = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

test('provenance and closed states are exhaustive without fallbacks', () => {
  for (const graph of graphs) {
    const metadata = metadataFor(graph);
    assert.equal(Object.keys(metadata.nodes).length, graph.nodes.length + graph.groups.length);
    assert.equal(Object.keys(metadata.edges).length, graph.edges.length);
    for (const [id, item] of Object.entries(metadata.nodes)) {
      assert.ok(item.kind, id); assert.ok(item.role, id); assert.ok(item.icon, id);
      assert.ok(Array.isArray(item.repo) && item.repo.length > 0, id);
      assert.ok(evidence.has(item.evidenceClass), id); assert.ok(runtime.has(item.runtimeState), id);
    }
    for (const [id, item] of Object.entries(metadata.edges)) {
      assert.ok(evidence.has(item.evidenceClass), id); assert.ok(runtime.has(item.runtimeState), id);
    }
  }
});

test('repository provenance covers application, platform, identity, geo and external ownership', () => {
  const repos = new Set(graphs.flatMap(graph => [...graph.nodes, ...graph.groups].flatMap(item => item.metadata.repo)));
  assert.deepEqual([...repos].sort(), ['external', 'geo', 'poc-k8s', 'radar-immobilier', 'sentropic']);
});
