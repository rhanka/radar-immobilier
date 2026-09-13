import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMermaid } from './parse-mermaid.mjs';
import { sceneFor } from './scenes.js';
import { routeAvoidsNodes } from '/kit/src/architecture-routing.js';
import { presentation } from './presentation-fr.js';
const { graphs, docs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

test('complete native scenes preserve exact identities and route around absolute leaf bounds', () => {
  assert.equal(graphs.length, 5);
  for (const graph of graphs) {
      const scene = sceneFor(graph), leaves = scene.absoluteNodes.filter(n => !n.data.group);
      for (const node of scene.nodes) {
        assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
        if (node.parentId) {
          const frame = scene.nodes.find(n => n.id === node.parentId);
          assert.ok(node.position.x >= 0 && node.position.y >= 0);
          assert.ok(node.position.x + node.width <= frame.width + .01);
          assert.ok(node.position.y + node.height <= frame.height + .01);
        }
      }
      for (const edge of scene.edges) {
        assert.ok(routeAvoidsNodes(edge, leaves), `route crosses a component: ${edge.id}`);
        assert.ok(scene.nodes.some(n => n.id === edge.source));
        assert.ok(scene.nodes.some(n => n.id === edge.target));
        assert.equal(edge.source, edge.originalSource); assert.equal(edge.target, edge.originalTarget);
        const original = graph.edges.find(e => e.id === edge.id);
        assert.equal(edge.label, original.label); assert.equal(edge.dashed, original.dashed); assert.equal(edge.both, original.both);
      }
      const nodes = leaves;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const overlap = a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
        assert.equal(overlap, false, `${graph.id}: overlapping nodes ${a.id}, ${b.id}`);
      }
    for (const node of [...graph.nodes, ...graph.groups]) assert.ok(scene.nodes.some(n => n.id === node.id), `lost node/group ${node.id}`);
    for (const edge of graph.edges) assert.ok(scene.edges.some(e => e.id === edge.id), `lost exact relationship ${edge.id}`);
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

test('dossier presents the engaged D4 plan and only the unresolved billing question', () => {
  assert.equal(presentation.length, 8);
  assert.match(presentation.join('\n'), /TEM reste/);
  assert.match(presentation[0], /T1.*T2.*T3/s);
  assert.match(presentation.join('\n'), /méthode.*allocation LLM/i);
  assert.doesNotMatch(presentation.join('\n'), /exécution différée|sans démarrer les travaux|ordre des travaux.*A.*B.*C/s);
  assert.equal(docs['decision-dossier'].match(/^## /gm).length, 8);
  assert.match(docs['decision-dossier'], /Revision \*\*D4/);
  assert.match(docs['decision-dossier'], /retain SCW TEM/);
  assert.match(docs.transitions, /refresh first,\nMinIO second, one-node Kubernetes third/);
});
