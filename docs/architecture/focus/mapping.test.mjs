import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMermaid } from './parse-mermaid.mjs';
import { sceneFor } from './scenes.js';
import { routeAvoidsNodes } from '/kit/src/architecture-routing.js';
import { presentation } from './presentation-fr.js';
const { graphs, docs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

test('every Mermaid node, relationship and group survives native scene navigation', () => {
  assert.equal(graphs.length, 5);
  for (const graph of graphs) {
    const seenNodes = new Set(), seenEdges = new Set();
    for (const scope of [null, ...graph.groups.map(g => g.id)]) {
      const scene = sceneFor(graph, scope), frame = scene.nodes.find(n => n.id === 'scope-frame');
      if (scope) assert.ok(frame, `native parent frame missing: ${scope}`);
      for (const node of scene.nodes) {
        seenNodes.add(node.id);
        assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
        if (node.parentId) {
          assert.equal(node.parentId, 'scope-frame');
          assert.ok(node.position.x >= 0 && node.position.y >= 0);
          assert.ok(node.position.x + node.width <= frame.width + .01);
          assert.ok(node.position.y + node.height <= frame.height + .01);
        }
      }
      for (const edge of scene.edges) {
        assert.ok(routeAvoidsNodes(edge, scene.nodes.filter(n => n.id !== 'scope-frame')), `route crosses a component: ${edge.id}`);
        assert.ok(scene.nodes.some(n => n.id === edge.source));
        assert.ok(scene.nodes.some(n => n.id === edge.target));
        if (edge.source === edge.originalSource && edge.target === edge.originalTarget) seenEdges.add(edge.id);
        const original = graph.edges.find(e => e.id === edge.id);
        assert.equal(edge.label, original.label); assert.equal(edge.dashed, original.dashed); assert.equal(edge.both, original.both);
      }
      const nodes = scene.nodes.filter(n => n.id !== 'scope-frame');
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const overlap = a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
        assert.equal(overlap, false, `${graph.id}/${scope}: overlapping nodes ${a.id}, ${b.id}`);
      }
    }
    for (const node of [...graph.nodes, ...graph.groups]) assert.ok(seenNodes.has(node.id), `lost node/group ${node.id}`);
    for (const edge of graph.edges) assert.ok(seenEdges.has(edge.id), `lost exact relationship ${edge.id}`);
  }
});

test('preprod stores and DB retain exact identities across infrastructure and PV views', () => {
  for (const id of ['PP-DB', 'PP-RAW', 'PP-DOCS', 'PP-GRAPH', 'GEO-S3', 'PP-GEO-S3']) {
    assert.ok(graphs[0].nodes.some(n => n.resource === id));
    assert.ok(graphs[1].nodes.some(n => n.resource === id));
  }
  assert.equal(graphs[0].groups.find(g => g.id === 'ppminio').label, graphs[1].groups.find(g => g.id === 'ppminio').label);
  assert.ok(graphs[1].edges.some(e => e.target === 'GEO_S3' && e.label.includes('raw/pv-index/cas/')));
  assert.ok(graphs[1].edges.some(e => e.source === 'PP_SCRAPE' && e.target === 'PP_DB' && e.label.includes('NOT served')));
});

test('unsupported syntax and dangling references fail closed', () => {
  assert.throws(() => parseMermaid('flowchart LR\na["A"]\na --> missing', 'bad', 'bad'), /undeclared/);
  assert.throws(() => parseMermaid('flowchart LR\na["A"]\nclick a "javascript:alert(1)"', 'bad', 'bad'), /unsupported/);
  assert.throws(() => parseMermaid('flowchart LR\nsubgraph g["G"]', 'bad', 'bad'), /unclosed/);
  assert.throws(() => parseMermaid('flowchart LR\na --> b --> c', 'bad', 'bad'), /unsupported/);
});

test('dossier remains a presentation with eight sections and the fixed TEM exception', () => {
  assert.equal(presentation.length, 8);
  assert.match(presentation.join('\n'), /TEM reste/);
  assert.match(presentation[7], /Pas de demande d’approbation/);
  assert.equal(docs['decision-dossier'].match(/^## /gm).length, 8);
  assert.match(docs['decision-dossier'], /INCOMPLETE/);
  assert.match(docs['decision-dossier'], /retain SCW TEM/);
  assert.match(docs['decision-dossier'], /does not request approval/);
});
