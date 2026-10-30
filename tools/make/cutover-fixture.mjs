import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
export function fixture(changes = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cutover-test-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const boundary = resolve('deploy/cutover/test-boundary.cjs');
  for (const tool of ['kubectl', 'curl']) writeFileSync(join(bin, tool),
    `#!/bin/sh\ncase "$*" in *port-forward*|*auth?can-i*) exec node '${boundary}' '${tool}' "$@";; esac\nexec flock -F '${dir}/mutex' node '${boundary}' '${tool}' "$@"\n`, { mode: 0o755 });
  const sha = 'a'.repeat(40);
  const release = { version: 1, gitSha: sha, apiImage: `ghcr.io/rhanka/radar-api@sha256:${'b'.repeat(64)}`,
    uiImage: `ghcr.io/rhanka/radar-ui@sha256:${'c'.repeat(64)}`, apiServedSha: sha, uiServedSha: sha.slice(0, 7), dataMigration: '6h' };
  const object = (kind, name, spec) => ({ apiVersion: 'v1', kind, metadata: { name, uid: `uid-${name}`, resourceVersion: '1', generation: 1 }, spec });
  const objects = [];
  objects.push({ ...object('Secret', 'radar-db-credentials', {}),
    data: { POSTGRES_DB: Buffer.from('radar').toString('base64'), POSTGRES_USER: 'synthetic-user', POSTGRES_PASSWORD: 'synthetic-only' } });
  // Canonical slot: adopted (`sentropic.io/slot=main`) unless the test models the pre-adoption state.
  const slot = changes.unadopted ? {} : { 'sentropic.io/slot': 'main' };
  for (const [name, container, image] of [['radar-api', 'api', 'api'], ['radar-ui', 'ui', 'ui'], ['radar-immo-mcp', 'mcp', 'api']]) {
    const component = container === 'mcp' ? 'mcp' : image;
    const labels = { 'app.kubernetes.io/name': 'radar-immobilier', 'app.kubernetes.io/component': component };
    objects.push(object('Deployment', name, { replicas: 1, selector: { matchLabels: { ...labels, ...slot } },
      template: { metadata: { labels: { ...labels, ...slot } }, spec: { containers: [{ name: container, image: `ghcr.io/rhanka/radar-${image}:old` }] } } }));
    const service = object('Service', name, { selector: { ...labels, ...slot }, ports: [{ name: 'http', port: 80 }] });
    service.metadata.uid = `uid-svc-${name}`; objects.push(service);
    objects.push(object('Endpoints', name, {}));
    const rs = object('ReplicaSet', `${name}-rs`, { selector: { matchLabels: { ...labels, ...slot } } });
    rs.metadata.ownerReferences = [{ kind: 'Deployment', controller: true, uid: `uid-${name}` }]; objects.push(rs);
    const pod = object('Pod', `${name}-consumer`, {});
    pod.metadata.ownerReferences = [{ kind: 'ReplicaSet', controller: true, uid: rs.metadata.uid }];
    pod.metadata.labels = { ...labels, ...slot };
    pod.status = { phase: 'Running', containerStatuses: [{ name: container, ready: true,
      imageID: image === 'ui' ? release.uiImage : release.apiImage }] }; objects.push(pod);
  }
  const cj = object('CronJob', 'radar-refresh-pv', { suspend: false, jobTemplate: { spec: { template: { spec: {
    containers: [{ name: 'refresh', image: 'ghcr.io/rhanka/radar-api:old' }], initContainers: [{ name: 'init', image: 'ghcr.io/rhanka/radar-api:old' }] } } } } });
  objects.push(cj, object('CronJob', 'radar-refresh-pending-watchdog', cj.spec),
    object('CronJob', 'originally-suspended', { suspend: true, jobTemplate: cj.spec.jobTemplate }));
  objects.push(object('Ingress', 'application', { tls: [{ hosts: ['preprod.immo.sent-tech.ca'], secretName: 'existing-tls' }],
    defaultBackend: { service: { name: 'radar-ui', port: { number: 8080 } } },
    rules: [{ host: 'preprod.immo.sent-tech.ca', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'radar-ui', port: { number: 8080 } } } }] } }] }));
  objects.push({ ...object('PersistentVolumeClaim', 'postgres-data-radar-postgres-0', { resources: { requests: { storage: '5Gi' } } }),
    status: { capacity: { storage: '5Gi' } } });
  objects.push({ ...object('ConfigMap', 'radar-api', {}), data: { GEO_DOCUMENTS_REPOINT: 'old' } });
  objects.push({ ...object('ConfigMap', 'radar-cutover-6h', {}), data: { 'plan.json': JSON.stringify({ version: 1,
    actorSub: 'synthetic-production-subject', workspaceSlug: 'synthetic', accounts: [{ sub: 'synthetic-production-subject' }] }) } });
  objects.push(object('NetworkPolicy', 'allow-bascule-to-postgres', { podSelector: { matchLabels: { 'app.kubernetes.io/component': 'postgres' } },
    ingress: [{ ports: [{ port: 5432 }], from: [{ podSelector: { matchLabels: { 'app.kubernetes.io/name': 'radar-immobilier' },
      matchExpressions: [{ key: 'sentropic.io/bascule', operator: 'Exists' }] } }] }] }));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ objects, release, url: 'https://preprod.immo.sent-tech.ca', ...changes }));
  writeFileSync(join(dir, 'release.json'), JSON.stringify(release));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CUTOVER_TEST_STATE: dir };
  delete env.NAMESPACE; delete env.PREPROD_NAMESPACE; delete env.GITHUB_RUN_ID;
  delete env.GITHUB_ENV; delete env.GITHUB_OUTPUT;
  env.GITHUB_ACTIONS = 'false';
  if (changes.fastClock) env['BASH_FUNC_sleep%%'] = '() { if [ "$1" = 2 ]; then SECONDS=$((SECONDS+31)); else command sleep "$@"; fi; }';
  const run = (action = 'run', extra = [], environment = 'preprod') => {
    const result = spawnSync('make', ['-s', '-f', 'deploy/cutover/operator.mk', action,
      `RELEASE=${dir}/release.json`, 'MODE=restore', ...extra, `ENV=${environment}`], { env, encoding: 'utf8', timeout: 240000 });
    if (result.error) throw result.error;
    return result;
  };
  return { dir, env, run, release, state: () => JSON.parse(readFileSync(join(dir, 'state.json'))),
    calls: () => readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(l => JSON.parse(l)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
