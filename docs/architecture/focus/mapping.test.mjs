import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMermaid } from './parse-mermaid.mjs';
import { sceneFor } from './scenes.js';
import { routeAvoidsNodes } from '/kit/src/architecture-routing.js';
import { presentation } from './presentation-fr.js';
const { graphs, docs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const currentReport = await readFile('../../reports/architecture-monthly/report-through-2026-09-13.md', 'utf8');

test('complete native scenes preserve exact identities and route around absolute leaf bounds', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['asis-1', 'asis-2', 'asis-3', 'asis-4', 'target-1', 'target-2', 'target-3', 'detail-1']);
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

test('D5 leads with complete sequential architecture and keeps fixed billing instructions last', () => {
  assert.equal(presentation.length, 8);
  assert.match(presentation[0], /architecture finale complète.*un seul b3-8/si);
  assert.match(presentation[1], /Existant.*T1.*T2.*T3/s);
  assert.match(presentation[1], /15:38 UTC/);
  assert.match(presentation[2], /candidat frais.*3\.4.*publication.*projection PG.*Signal typé.*PDF exact/s);
  assert.match(presentation[2], /0\.18\.0.*immo-pv-extraction-v3.*ac3a7150.*8\/8 \+ 7\/7.*UND_ERR_SOCKET/s);
  assert.match(presentation[3], /PP-RAW-OVH.*PP-DOCS-OVH.*préprod avant prod/s);
  assert.match(presentation[4], /9 454 Mi.*5 907,82 Mi.*347 Mi/s);
  assert.match(presentation[7], /ANNEXE FACTURATION · EN DERNIER/);
  assert.match(presentation[7], /vraie frontière.*non vérifiée.*2026-09-14T00:00:00-04:00/s);
  assert.match(presentation[7], /mêmes tarifs unitaires.*facture réelle du mois précédent/s);
  assert.doesNotMatch(presentation.slice(0, 7).join('\n'), /question.*allocation LLM|choisir.*DIRECT/i);
  assert.equal(docs['decision-dossier'].match(/^## /gm).length, 8);
  assert.match(docs['decision-dossier'], /Revision \*\*D5/);
  assert.match(docs['decision-dossier'], /option` is `null`: no method was selected/);
  assert.match(docs['decision-dossier'], /ac3a7150.*8\/8 \+ 7\/7.*no real-provider Signal.*UND_ERR_SOCKET/s);
  assert.match(docs.transitions, /inside the requested period/);
  assert.match(currentReport, /Runtime architecture cutoff:.*2026-09-13T15:38:00Z/);
  assert.match(currentReport, /Transition implementation cutoff:.*2026-09-13T15:39:00Z/);
  assert.equal((docs['transitions-target'].match(/```mermaid/g) ?? []).length, 3);
});

test('transition states preserve physical IDs and final-target exclusions', () => {
  const [t1, t2, t3, detail] = ['target-1', 'target-2', 'target-3', 'detail-1'].map(id => graphs.find(graph => graph.id === id));
  for (const graph of [t1, t2, t3]) for (const id of ['PP_UI', 'PP_API', 'PP_MCP', 'PP_DB', 'PP_REFRESH', 'PR_UI', 'PR_API', 'PR_MCP', 'PR_DB', 'PR_REFRESH', 'GEO_API', 'GEO_DB', 'GEO_S3']) assert.ok(graph.nodes.some(node => node.id === id), `${graph.id}/${id}`);
  for (const id of ['T1_CHANGE', 'T1_KEEP', 'T1_REMOVE', 'T1_GATES', 'T1_EVIDENCE']) assert.ok(t1.nodes.some(node => node.id === id));
  for (const id of ['PP_RAW', 'PP_DOCS', 'PP_RAW_OVH', 'PP_DOCS_OVH']) assert.ok(t2.nodes.some(node => node.id === id));
  for (const id of ['PP_RAW_OVH', 'PP_DOCS_OVH', 'PR_RAW_OVH', 'PR_DOCS_OVH', 'TEM', 'PV_SRC', 'ZONES_SRC', 'REGULATIONS_SRC', 'LOTS_SRC', 'ENV_SRC']) assert.ok(t3.nodes.some(node => node.id === id));
  for (const removed of ['PP_RAW', 'PP_DOCS', 'SCW_RESIDUE']) assert.ok(!t3.nodes.some(node => node.id === removed));
  assert.ok(!t3.groups.some(group => group.id === 'ppminio'));
  for (const graph of [t1, t2, t3]) for (const source of ['PP_API', 'PR_API']) {
    const email = graph.edges.find(edge => edge.source === source && edge.target === 'TEM');
    assert.ok(email?.dashed, `${graph.id}/${source}: retained TEM relation must remain qualified`);
  }
  for (const [source, target] of [['candidate', 'post'], ['post', 'publish'], ['publish', 'project'], ['project', 'served']]) assert.ok(detail.edges.some(edge => edge.source === source && edge.target === target));
});
