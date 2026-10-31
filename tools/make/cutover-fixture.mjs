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
  const RESOURCES = { api: { requests: { cpu: '30m', memory: '256Mi' }, limits: { cpu: '500m', memory: '768Mi' } },
    ui: { requests: { cpu: '30m', memory: '64Mi' }, limits: { cpu: '100m', memory: '128Mi' } },
    mcp: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '150m', memory: '256Mi' } } };
  // Canonical slot: adopted (`sentropic.io/slot=main`) unless the test models the pre-adoption state.
  const slot = changes.unadopted ? {} : { 'sentropic.io/slot': 'main' };
  for (const [name, container, image] of [['radar-api', 'api', 'api'], ['radar-ui', 'ui', 'ui'], ['radar-immo-mcp', 'mcp', 'api']]) {
    const component = container === 'mcp' ? 'mcp' : image;
    const labels = { 'app.kubernetes.io/name': 'radar-immobilier', 'app.kubernetes.io/component': component };
    objects.push(object('Deployment', name, { replicas: 1, selector: { matchLabels: { ...labels, ...slot } },
      template: { metadata: { labels: { ...labels, ...slot } }, spec: { containers: [{ name: container, image: `ghcr.io/rhanka/radar-${image}:old`,
        resources: RESOURCES[container] }],
        ...(container === 'ui' ? { volumes: [{ name: 'nginx-conf', configMap: { name: 'radar-ui-nginx' } }] } : {}) } } }));
    const service = object('Service', name, { selector: { ...labels, ...slot }, ports: [{ name: 'http', port: 80 }] });
    service.metadata.uid = `uid-svc-${name}`; objects.push(service);
    objects.push(object('Endpoints', name, {}));
    const rs = object('ReplicaSet', `${name}-rs`, { selector: { matchLabels: { ...labels, ...slot } } });
    rs.metadata.ownerReferences = [{ kind: 'Deployment', controller: true, uid: `uid-${name}` }]; objects.push(rs);
    const pod = object('Pod', `${name}-consumer`, {});
    pod.metadata.ownerReferences = [{ kind: 'ReplicaSet', controller: true, uid: rs.metadata.uid, name: rs.metadata.name }];
    pod.metadata.labels = { ...labels, ...slot };
    pod.status = { phase: 'Running', containerStatuses: [{ name: container, ready: true,
      // With a previousSha the running Pods serve an older build (previous release).
      imageID: changes.previousSha ? `ghcr.io/rhanka/radar-${image}@sha256:${'9'.repeat(64)}` : image === 'ui' ? release.uiImage : release.apiImage }] }; objects.push(pod);
  }
  // Release manifests (#611): the delivered commit's workloads, distinguishable from the live ones.
  const NGINX = 'radar-ui-nginx-7k2m9h5tgb';
  const manifestDeployments = [['radar-api', 'api', 'api'], ['radar-ui', 'ui', 'ui'], ['radar-immo-mcp', 'mcp', 'api']].map(([name, container, image]) => {
    const labels = { 'app.kubernetes.io/name': 'radar-immobilier', 'app.kubernetes.io/component': container === 'mcp' ? 'mcp' : image };
    return { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, labels }, spec: { replicas: 1, selector: { matchLabels: labels },
      strategy: { type: container === 'mcp' ? 'Recreate' : 'RollingUpdate' },
      template: { metadata: { labels }, spec: { containers: [{ name: container, image: `ghcr.io/rhanka/radar-${image}:release`,
        resources: RESOURCES[container], env: [{ name: 'FROM_RELEASE_MANIFEST', value: '1' }],
        ...(container === 'ui' ? { volumeMounts: [{ name: 'nginx-conf', mountPath: '/etc/nginx/conf.d' }] } : {}) }],
        ...(container === 'ui' ? { volumes: [{ name: 'nginx-conf', configMap: { name: NGINX } }] } : {}) } } } };
  });
  // kustomize configMapGenerator: a content-hashed name, absent from the live namespace.
  const nginxManifest = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: NGINX }, data: { 'default.conf':
    '# release nginx\nlocation /api/ { proxy_pass http://radar-api:3000; }\nlocation = /health { proxy_pass http://radar-api:3000/health; }\n' } };
  const manifestCronJob = { apiVersion: 'batch/v1', kind: 'CronJob', metadata: { name: 'radar-refresh-pv' }, spec: { suspend: false,
    jobTemplate: { spec: { template: { spec: { containers: [{ name: 'refresh', image: 'ghcr.io/rhanka/radar-api:release',
      env: [{ name: 'FROM_RELEASE_MANIFEST', value: '1' }] }] } } } } } };
  const releaseManifests = { 'deploy/overlays/preprod': [...manifestDeployments, nginxManifest], 'deploy/k8s/refresh-cronjobs': [manifestCronJob],
    'deploy/k8s': [...manifestDeployments, nginxManifest], 'deploy/k8s/immo-mcp': [] };
  const cj = object('CronJob', 'radar-refresh-pv', { suspend: false, jobTemplate: { spec: { template: { spec: {
    containers: [{ name: 'refresh', image: 'ghcr.io/rhanka/radar-api:old' }], initContainers: [{ name: 'init', image: 'ghcr.io/rhanka/radar-api:old' }] } } } } });
  objects.push(cj, object('CronJob', 'radar-refresh-pending-watchdog', cj.spec),
    object('CronJob', 'originally-suspended', { suspend: true, jobTemplate: cj.spec.jobTemplate }));
  objects.push(object('Ingress', 'application', { tls: [{ hosts: ['preprod.immo.sent-tech.ca'], secretName: 'existing-tls' }],
    defaultBackend: { service: { name: 'radar-ui', port: { number: 8080 } } },
    rules: [{ host: 'preprod.immo.sent-tech.ca', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'radar-ui', port: { number: 8080 } } } }] } }] }));
  // Expanded volume by default (Lot 1 applied); pvcSize models the original 5 Gi claim.
  objects.push({ ...object('PersistentVolumeClaim', 'postgres-data-radar-postgres-0', { resources: { requests: { storage: changes.pvcSize || '20Gi' } } }),
    status: { capacity: { storage: changes.pvcSize || '20Gi' } } });
  objects.push({ ...object('ConfigMap', 'radar-ui-nginx', {}), data: { 'default.conf':
    'location /api/ { proxy_pass http://radar-api:3000; }\nlocation = /health { proxy_pass http://radar-api:3000/health; }\n' } });
  // Preprod quota as measured on 2026-10-30 (limits.cpu 3 / used 1350m, limits.memory 6Gi / used 1920Mi, pods 20 / 4).
  objects.push({ ...object('ResourceQuota', 'preprod-cap', {}), status: changes.quota || {
    hard: { 'limits.cpu': '3', 'limits.memory': '6Gi', 'requests.cpu': '400m', pods: '20' },
    used: { 'limits.cpu': '1350m', 'limits.memory': '1920Mi', 'requests.cpu': '90m', pods: '4' } } });
  objects.push({ ...object('ConfigMap', 'radar-api', {}), data: { GEO_DOCUMENTS_REPOINT: 'old' } });
  objects.push({ ...object('ConfigMap', 'radar-cutover-6h', {}), data: { 'plan.json': JSON.stringify({ version: 1,
    actorSub: 'synthetic-production-subject', workspaceSlug: 'synthetic', accounts: [{ sub: 'synthetic-production-subject' }] }) } });
  objects.push(object('NetworkPolicy', 'allow-bascule-to-postgres', { podSelector: { matchLabels: { 'app.kubernetes.io/component': 'postgres' } },
    ingress: [{ ports: [{ port: 5432 }], from: [{ podSelector: { matchLabels: { 'app.kubernetes.io/name': 'radar-immobilier' },
      matchExpressions: [{ key: 'sentropic.io/bascule', operator: 'Exists' }] } }] }] }));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ objects, release, releaseManifests, url: 'https://preprod.immo.sent-tech.ca', ...changes }));
  writeFileSync(join(dir, 'release.json'), JSON.stringify(release));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CUTOVER_TEST_STATE: dir };
  delete env.NAMESPACE; delete env.PREPROD_NAMESPACE; delete env.GITHUB_RUN_ID;
  delete env.GITHUB_ENV; delete env.GITHUB_OUTPUT;
  env.GITHUB_ACTIONS = 'false';
  // Blue/green timings shortened for the fake cluster (retention, drain, first-serve wait).
  Object.assign(env, { OBSERVE: '0', DRAIN: '0', SERVE_TIMEOUT: '3', LOCK_WAIT: '0', STATS_SETTLE: '0', CUTOVER_TEST_TREE_SHA: sha });
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
