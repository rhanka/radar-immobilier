import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const jq = (filter, input, args = []) => {
  const result = spawnSync('jq', [...args, '-c', '-f', filter], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
};
const labels = component => ({ 'app.kubernetes.io/name': 'radar-immobilier', 'app.kubernetes.io/component': component });
const sts = (name, component = 'postgres') => ({ kind: 'StatefulSet', metadata: { name, uid: `uid-${name}` },
  spec: { selector: { matchLabels: labels(component) }, template: { metadata: { labels: labels(component) } } } });
const pod = (name, ownerKind, component) => ({ metadata: { name, uid: `uid-${name}`, labels: labels(component),
  ownerReferences: ownerKind ? [{ kind: ownerKind, controller: true, uid: `uid-owner-${name}` }] : [] }, status: { phase: 'Running' } });

test('both PostgreSQL StatefulSets are supported controllers; other StatefulSets are not', () => {
  const out = jq('tools/make/cutover-controllers.jq', { items: [sts('radar-postgres'), sts('radar-pg18'), sts('radar-cache', 'cache')] });
  assert.deepEqual(out, ['StatefulSet/radar-cache']);
});

test('pods of any PostgreSQL StatefulSet are not consumers; a labelled bare pod still is', () => {
  const record = [{ jobs: [], cronjobs: [], deployments: [] }];
  const out = jq('tools/make/cutover-consumers.jq', { items: [pod('radar-postgres-0', 'StatefulSet', 'postgres'),
    pod('radar-pg18-0', 'StatefulSet', 'postgres'), pod('impostor', null, 'postgres')] },
  ['--argjson', 'r', JSON.stringify(record), '--argjson', 'jobs', '[{"items":[]}]', '--argjson', 'rs', '[{"items":[]}]']);
  assert.deepEqual(out[0].map(c => c.name), ['impostor']);
});

test('closure ignores PostgreSQL Service endpoints by label only', () => {
  const ep = (name, component) => ({ metadata: { name, labels: labels(component) }, subsets: [{ addresses: [{ ip: '10.0.0.1' }] }] });
  assert.deepEqual(jq('tools/make/cutover-endpoints.jq', { items: [ep('radar-postgres', 'postgres'), ep('radar-pg16', 'postgres'),
    ep('radar-pg18', 'postgres')] }), [true]);
  assert.deepEqual(jq('tools/make/cutover-endpoints.jq', { items: [ep('radar-pg18', 'postgres'), ep('radar-api', 'api')] }), [false]);
});

test('snapshot keeps application Deployments and drops PostgreSQL ones by label', () => {
  const dep = (name, component) => ({ metadata: { name, uid: name, labels: labels(component) }, spec: { template: { spec: { containers: [] } } } });
  const out = jq('tools/make/cutover-snapshot.jq', {}, ['--arg', 'env', 'preprod',
    '--argjson', 'd', JSON.stringify([{ items: [dep('radar-api', 'api'), dep('pg-helper', 'postgres')] }]),
    '--argjson', 'c', '[{"items":[]}]', '--argjson', 'i', '[{"items":[]}]', '--argjson', 'cfg', '[]']);
  assert.deepEqual(out[0].deployments.map(d => d.name), ['radar-api']);
});

test('pg-switch renders the manifest Service with one pod and the target namespace', () => {
  const manifest = { kind: 'List', items: [
    { apiVersion: 'v1', kind: 'Service', metadata: { name: 'radar-postgres', namespace: 'radar-immobilier', labels: labels('postgres') },
      spec: { selector: { ...labels('postgres'), 'statefulset.kubernetes.io/pod-name': 'radar-postgres-0' }, ports: [{ port: 5432 }] } },
    sts('radar-postgres')] };
  const [svc] = jq('tools/make/cutover-pg-service.jq', manifest,
    ['--arg', 'ns', 'radar-immobilier-preprod', '--arg', 'pod', 'radar-pg18-0']);
  assert.equal(svc.metadata.namespace, 'radar-immobilier-preprod');
  assert.equal(svc.spec.selector['statefulset.kubernetes.io/pod-name'], 'radar-pg18-0');
  assert.equal(svc.spec.selector['app.kubernetes.io/component'], 'postgres');
  assert.deepEqual(svc.spec.ports, [{ port: 5432 }]);
});

test('pg verbs refuse the default kubeconfig, a missing one, and a disabled environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pg-verbs-'));
  try {
    const kubeconfig = join(dir, 'tenant.kubeconfig'); writeFileSync(kubeconfig, 'apiVersion: v1\n');
    const run = (env) => spawnSync('bash', ['tools/make/cutover-pg.sh', 'pg-verify'],
      { env: { PATH: process.env.PATH, HOME: dir, ...env }, encoding: 'utf8' });
    let r = run({ ENV: 'preprod' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /KUBECONFIG must name/);
    mkdirSync(join(dir, '.kube')); writeFileSync(join(dir, '.kube', 'config'), 'apiVersion: v1\n');
    r = run({ ENV: 'preprod', KUBECONFIG: join(dir, '.kube', 'config') });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /default kubeconfig is never used/);
    r = run({ ENV: 'prod', KUBECONFIG: kubeconfig });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /not enabled for prod/);
    r = run({ ENV: 'preprod', KUBECONFIG: kubeconfig, NAMESPACE: 'radar-immobilier' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /Namespace overrides are forbidden/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dump images are pinned per environment and follow the server major', () => {
  const config = JSON.parse(spawnSync('cat', ['deploy/cutover/config.json'], { encoding: 'utf8' }).stdout);
  assert.match(config.preprod.dumpImage, /^postgis\/postgis:18-3\.6@sha256:[0-9a-f]{64}$/);
  assert.match(config.prod.dumpImage, /^postgis\/postgis:16-3\.4@sha256:[0-9a-f]{64}$/);
  assert.equal(config.prod.pgUpgrade, undefined);
});
