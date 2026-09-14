import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const graph = id => graphs.find(item => item.id === id);
const ids = item => new Set([...item.nodes, ...item.groups].map(node => node.id));

test('pair A carries the dated storage and registry transition with TEM retained', () => {
  const before = graph('storage-before-20260809'), after = graph('storage-after-20260913');
  assert.equal(before.date, '2026-08-09'); assert.equal(after.date, '2026-09-13');
  for (const id of ['A_MINIO', 'A_SCWREG', 'A_SCWDOCS', 'A_TEM']) assert.ok(ids(before).has(id), id);
  for (const id of ['A_DOCS', 'A_GHCR', 'A_TEM']) assert.ok(ids(after).has(id), id);
  for (const id of ['A_MINIO', 'A_SCWREG', 'A_SCWDOCS', 'A_SCWGRAPH']) assert.ok(!ids(after).has(id), id);
  assert.ok(after.edges.some(edge => edge.source === 'A_API' && edge.target === 'A_TEM' && /retained/.test(edge.label)));
});
test('pair B stays provider-neutral and production remains dormant', () => {
  const before = graph('refresh-before-20260809'), after = graph('refresh-after-20260913');
  assert.equal(before.groups.find(node => node.id === 'B_WORKSTATION').metadata.runtimeState, 'manual');
  assert.equal(before.nodes.find(node => node.id === 'B_SCHEDULE').metadata.runtimeState, 'suspended');
  assert.equal(after.groups.find(node => node.id === 'B_REFRESH').parent, 'B_CLOUD');
  assert.equal(after.groups.find(node => node.id === 'B_REFRESH').metadata.runtimeState, 'dormant');
  assert.equal(after.nodes.find(node => node.id === 'B_MODEL').metadata.runtimeState, 'unknown');
  for (const id of ['B_CORPUS', 'B_GRAPH']) assert.doesNotMatch(after.nodes.find(node => node.id === id).label, /SCW|OVH|S3|MinIO/i);
  const tem = after.nodes.find(node => node.id === 'B_TEM');
  assert.equal(tem.metadata.runtimeState, 'retained');
  assert.ok(!after.edges.some(edge => edge.source === tem.id || edge.target === tem.id));
});

test('the exact user label exists once in each canonical graph', () => {
  for (const item of graphs) {
    assert.equal(item.nodes.filter(node => node.label === 'Navigateur utilisateur').length, 1);
    assert.ok(!item.source.includes('UTILISATEUR / Navigateur'));
  }
});
