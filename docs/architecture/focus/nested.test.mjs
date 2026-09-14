import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const graph = id => graphs.find(item => item.id === id);
const ids = item => new Set([...item.nodes, ...item.groups].map(node => node.id));
const flowSource = await readFile('Flow.svelte', 'utf8');
const viewportSource = await readFile('Viewport.svelte', 'utf8');
const nodeSource = await readFile('ServiceNode.svelte', 'utf8');
const subflowSource = await readFile('Subflow.svelte', 'utf8');
const scenesSource = await readFile('scenes.js', 'utf8');
const { roleIsShort } = await import('./scene-metadata.js');

test('series A carries July, August 10 and current hosting states', () => {
  const july = graph('hosting-july-2026'), august = graph('hosting-august-20260810'), today = graph('hosting-today-20260913');
  assert.equal(july.date, '2026-07'); assert.equal(august.date, '2026-08-10'); assert.equal(today.date, '2026-09-13');
  for (const id of ['A_SCW', 'A_MINIO', 'A_SCWREG', 'A_TEM']) assert.ok(ids(july).has(id), id);
  for (const id of ['A_OVH', 'A_MINIO', 'A_TEM']) assert.ok(ids(august).has(id), id);
  for (const id of ['A_OVH', 'A_PREPROD', 'A_PROD', 'A_PP_S3', 'A_PR_S3', 'A_GHCR', 'A_TEM']) assert.ok(ids(today).has(id), id);
  assert.ok(!ids(today).has('A_MINIO'));
});
test('every scene keeps the codex-13-sept baseline containers and components', () => {
  for (const item of graphs) {
    const boxes = [...item.nodes, ...item.groups];
    const cluster = item.groups.find(group => group.metadata.repo.includes('poc-k8s') && group.metadata.kind === 'cluster');
    assert.ok(cluster, `${item.id}: no Kubernetes cluster container`);
    assert.ok(item.groups.some(group => group.parent === cluster.id), `${item.id}: cluster has no namespace container`);
    const traefik = item.nodes.find(node => /Traefik/.test(node.metadata.role) || /Traefik/.test(node.label));
    assert.ok(traefik && traefik.parent === cluster.id, `${item.id}: Traefik missing or outside the cluster`);
    assert.ok(boxes.some(box => box.metadata.repo.includes('sentropic')) || item.pair === 'B', `${item.id}: no SSO platform component`);
    assert.ok(boxes.some(box => box.metadata.kind === 'exception'), `${item.id}: no retained Scaleway exception`);
  }
  for (const id of ['hosting-july-2026', 'hosting-august-20260810', 'hosting-today-20260913']) {
    const item = graph(id);
    assert.ok([...item.nodes, ...item.groups].some(box => box.metadata.repo.includes('geo')), `${id}: no Geo component`);
    assert.ok(item.nodes.some(box => box.metadata.kind === 'registry'), `${id}: no application registry`);
    assert.ok(item.nodes.some(box => box.metadata.kind === 'workstation'), `${id}: no operator workstation`);
  }
});

test('pair B stays provider-neutral and production remains dormant', () => {
  const before = graph('pipeline-before-20260810'), after = graph('pipeline-after-20260913');
  assert.equal(before.groups.find(node => node.id === 'B_WORKSTATION').metadata.runtimeState, 'manual');
  assert.match(before.nodes.find(node => node.id === 'B_EXTRACT').label, /Graphify 2\.3/);
  assert.equal(after.groups.find(node => node.id === 'B_PREPROD').metadata.runtimeState, 'active');
  assert.equal(after.groups.find(node => node.id === 'B_PROD').metadata.runtimeState, 'dormant');
  assert.equal(after.nodes.find(node => node.id === 'B_PROD_CRON').metadata.runtimeState, 'dormant');
  for (const id of ['B_CORPUS', 'B_GRAPH']) assert.doesNotMatch(after.nodes.find(node => node.id === id).label, /SCW|OVH|S3|MinIO/i);
  const tem = after.nodes.find(node => node.id === 'B_TEM');
  assert.equal(tem.metadata.runtimeState, 'retained');
  assert.ok(!after.edges.some(edge => edge.source === tem.id || edge.target === tem.id));
});

test('the operator workstation is explicit before and executes nothing after', () => {
  const before = graph('pipeline-before-20260810'), after = graph('pipeline-after-20260913');
  // "Avant": the workstation is a real container and what ran on it is inside.
  const inside = before.nodes.filter(node => node.parent === 'B_WORKSTATION').map(node => node.id);
  for (const id of ['B_OPS', 'B_OPERATOR', 'B_EXTRACT', 'B_KEYS']) assert.ok(inside.includes(id), `${id} outside the workstation`);
  const ops = before.nodes.find(node => node.id === 'B_OPS');
  assert.equal(ops.metadata.card, 'A');
  assert.equal(ops.metadata.code, 'WS-OPS');
  assert.match(ops.metadata.detail, /collecte · extraction · projection/);
  // It drove the in-cluster steps by hand; nothing started on its own.
  for (const target of ['B_COLLECT', 'B_PROJECT'])
    assert.ok(before.edges.some(edge => edge.source === 'B_OPS' && edge.target === target), `no manual launch of ${target}`);
  // "Après": the same four named steps are in the cluster and the poste only enrols.
  const steps = [/Étape 1/, /Étape 2/, /Étape 3/, /Étape 4/];
  for (const item of [before, after]) for (const step of steps)
    assert.ok(item.nodes.some(node => step.test(node.metadata.role) || step.test(node.label)), `${item.id}: missing ${step}`);
  const ws = after.nodes.find(node => node.id === 'B_WS');
  assert.equal(ws.metadata.card, 'A');
  assert.equal(ws.metadata.code, 'WS-ADMIN');
  const stepIds = after.nodes.filter(node => /Étape/.test(node.metadata.role)).map(node => node.id);
  assert.equal(after.edges.filter(edge => edge.source === 'B_WS' && stepIds.includes(edge.target)).length, 0);
});

test('every box carries the single ratified card template', () => {
  for (const item of graphs) {
    for (const group of item.groups) {
      assert.equal(group.metadata.card, 'box', `${item.id}/${group.id}`);
      assert.equal(group.metadata.role, '', `${item.id}/${group.id}: a container carries no role title`);
    }
    for (const node of item.nodes) {
      const meta = node.metadata;
      assert.equal(meta.card, 'A', `${item.id}/${node.id}: ${meta.card}`);
      assert.ok(meta.code && meta.role && meta.name && meta.detail, `${item.id}/${node.id}: incomplete card`);
      assert.ok(!meta.name.includes(meta.code), `${item.id}/${node.id}: code repeated in the name`);
      assert.ok(!/manifest/i.test(meta.name) && !/manifest/i.test(meta.detail), `${item.id}/${node.id}: "manifests" wording`);
      assert.ok(roleIsShort(meta.role), `${item.id}/${node.id}: role "${meta.role}"`);
    }
  }
});

test('no card and no container carries an evidence / runtime status line', () => {
  // The owner removed « observé · actif » everywhere; the exceptional cases are
  // said in the detail line instead.
  assert.doesNotMatch(nodeSource, /data-text-role="status"/);
  assert.doesNotMatch(subflowSource, /data-text-role="status"/);
  assert.doesNotMatch(scenesSource, /statusLabel/);
  const tem = graph('hosting-today-20260913').nodes.find(node => node.id === 'A_TEM');
  assert.match(tem.metadata.detail, /seule exception/);
  const refresh = graph('hosting-today-20260913').nodes.find(node => node.id === 'A_PR_REFRESH');
  assert.match(refresh.metadata.detail, /dormant · gaté par PR #682/);
  for (const id of ['hosting-july-2026', 'hosting-august-20260810'])
    assert.match(graph(id).nodes.find(node => node.id === 'A_MINIO').metadata.detail, /stockage objet interne · PVC/);
});

test('the exact user label exists once in each canonical graph', () => {
  for (const item of graphs) {
    assert.equal(item.nodes.filter(node => node.label === 'Navigateur utilisateur').length, 1);
    assert.ok(!item.source.includes('UTILISATEUR / Navigateur'));
  }
});

test('native flows open fitted and retain zoom, pan, controls and actual size', () => {
  assert.match(flowSource, /fitView fitViewOptions=\{\{ padding: 0\.08 \}\} minZoom=\{0\.03\} maxZoom=\{2\}/);
  assert.match(flowSource, /<Controls showInteractive=\{false\} \/>/);
  assert.doesNotMatch(flowSource, /minZoom=\{1\}|maxZoom=\{1\}|defaultViewport=/);
  assert.match(viewportSource, /fitBounds\(target, \{ padding: 0\.08, duration: 150 \}\)/);
  assert.match(viewportSource, /data-action="actual-size"/);
  assert.match(viewportSource, /addEventListener\('dblclick'/);
});
