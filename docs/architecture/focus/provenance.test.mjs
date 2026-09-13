import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { provenanceFor } from './service-provenance.js';
import { serviceIcons } from './service-icons.js';
const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const transitionTargets = await readFile('../transitions-target.md', 'utf8');

test('every component and nested box has an explicit repo role, evidence and service icon', () => {
  const identities = new Map();
  for (const graph of graphs) for (const item of [...graph.nodes, ...graph.groups]) {
    const p = item.provenance;
    assert.deepEqual(p, provenanceFor(graph.id, item.id));
    assert.ok(serviceIcons[p.icon], `${graph.id}/${item.id}: icon missing`);
    assert.ok(p.repoLabel.startsWith('repo: ') && p.service && p.role && p.evidence);
    if (item.resource || item.id === 'ppminio') {
      if (identities.has(item.id)) assert.deepEqual(p, identities.get(item.id), item.id);
      identities.set(item.id, p);
    }
  }
  for (const graph of graphs.filter(graph => graph.id.startsWith('target'))) for (const item of [...graph.nodes, ...graph.groups]) assert.notEqual(item.provenance.icon, 'unknown', `${graph.id}/${item.id}: unknown target mapping`);
  assert.throws(() => provenanceFor('asis-1', 'unreviewed'), /Missing repository/);
});

test('platform, SSO, Immo, Geo, external and unassigned roles are not conflated', () => {
  for (const [id, repo] of [['cloud', 'poc-k8s'], ['pidp', 'sentropic'], ['pidb', 'sentropic'], ['PP_DB', 'radar-immobilier'], ['PP_GRAPH', 'radar-immobilier'], ['GEO_S3', 'geo']]) assert.deepEqual(provenanceFor('asis-1', id).repos, [repo]);
  assert.deepEqual(provenanceFor('asis-1', 'user').repos, []);
  assert.equal(provenanceFor('detail-1', 'credentials').repos, null);
  assert.match(provenanceFor('asis-1', 'PP_GRAPH').role, /création hors audit/);
  assert.match(provenanceFor('detail-1', 'graphify').role, /radar-immobilier/);
  assert.match(provenanceFor('target-3', 'PR_RAW_OVH').role, /binding TBD/);
  assert.deepEqual(provenanceFor('target-3', 'GEO_JOIN').repos, ['geo']);
  assert.equal(provenanceFor('asis-1', 'PP_RAW').service, 'S3 compatible · MinIO');
});

test('accepted preproduction DOCS provenance matches the D8 transition receipt', () => {
  const provenance = provenanceFor('target-3', 'PP_DOCS_OVH');
  const renderedProvenance = `${provenance.role} ${provenance.evidence}`;
  for (const fact of ['59,017', '12,534,514,457', '52646a7b…0425', 'failed 0']) {
    assert.ok(transitionTargets.includes(fact), `transition receipt missing ${fact}`);
    assert.ok(renderedProvenance.includes(fact), `provenance missing ${fact}`);
  }
  assert.doesNotMatch(renderedProvenance, /inventory in progress/i);
});
