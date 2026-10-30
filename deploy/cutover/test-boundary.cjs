// Stateful Kubernetes/HTTP double. Invoked only by isolated controller tests.
/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const process = require('node:process');
const { Buffer } = require('node:buffer');
const { setInterval } = require('node:timers');
const fs = require('node:fs');
const yaml = require('yaml');
const path = require('node:path');
const { URL } = require('node:url');
const [tool, ...input] = process.argv.slice(2);
const dir = process.env.CUTOVER_TEST_STATE;
if (!dir) process.exit(90);
fs.appendFileSync(path.join(dir, 'calls'), `${JSON.stringify([tool, ...input])}\n`);
let args = input.filter(a => !a.startsWith('--request-timeout='));
const ni = args.indexOf('-n'); if (ni >= 0) args.splice(ni, 2);
const file = path.join(dir, 'state.json');
const s = JSON.parse(fs.readFileSync(file));
const save = () => fs.writeFileSync(file, JSON.stringify(s));
if (s.apiLost && tool === 'kubectl' && args[0] !== 'config') process.exit(1);
const out = value => fs.writeFileSync(1, typeof value === 'string' ? value : JSON.stringify(value));
const key = kind => ({ configmap: 'ConfigMap', configmaps: 'ConfigMap', deployment: 'Deployment', deployments: 'Deployment',
  job: 'Job', jobs: 'Job', pods: 'Pod', service: 'Service', services: 'Service', cronjob: 'CronJob', cronjobs: 'CronJob',
  ingress: 'Ingress', ingresses: 'Ingress', endpoints: 'Endpoints', replicasets: 'ReplicaSet', networkpolicy: 'NetworkPolicy', secret: 'Secret' })[kind];
const find = (kind, name) => s.objects.find(o => o.kind === key(kind) && o.metadata.name === name);
const value = flag => args[args.indexOf(flag) + 1];
const jobVerdict = (step, job) => ['database', 'destination', 'reset', 'discard'].includes(step)
  ? { ok: true, database: job.spec.template.spec.containers[0].env.find(e => e.name === 'POSTGRES_DB')?.value
    || Buffer.from(find('secret', 'radar-db-credentials').data.POSTGRES_DB, 'base64').toString(), migrations: 25 }
  : step === 'resolve' ? { ok: true, date: '2026-10-29', backupId: 'latest', ageHours: 1,
    dumpStartedAt: '2026-10-29T01:00:00Z', migrations: 25,
    manifestSha256: 'd'.repeat(64), pgSha256: 'e'.repeat(64), pgSizeBytes: 1024, ...s.pinOverride } :
  (step === 'docs' || step === 'recon') && s.inventoryAnomalies ? { ok: true,
    inventoryAnomalies: s.inventoryAnomalies, inventoryAnomalyCount: s.inventoryAnomalies.length, inventoryAnomaliesTruncated: false } : step === 'data' ?
  { ok: true, status: 'open-success', epoch: 'scoped', sealedUnresolved: 0, maintenanceBarrier: false } : { ok: true };
// RBAC access log: every API access the controller performs, as {verb, resource, group, name}.
const RESOURCES = { configmap: ['configmaps', ''], configmaps: ['configmaps', ''], secret: ['secrets', ''], service: ['services', ''],
  services: ['services', ''], pods: ['pods', ''], 'pods/portforward': ['pods/portforward', ''], endpoints: ['endpoints', ''], deployment: ['deployments', 'apps'],
  deployments: ['deployments', 'apps'], replicasets: ['replicasets', 'apps'], statefulsets: ['statefulsets', 'apps'],
  daemonsets: ['daemonsets', 'apps'], horizontalpodautoscalers: ['horizontalpodautoscalers', 'autoscaling'],
  job: ['jobs', 'batch'], jobs: ['jobs', 'batch'], cronjob: ['cronjobs', 'batch'], cronjobs: ['cronjobs', 'batch'],
  ingress: ['ingresses', 'networking.k8s.io'], ingresses: ['ingresses', 'networking.k8s.io'],
  networkpolicy: ['networkpolicies', 'networking.k8s.io'] };
const KIND_RESOURCE = { ConfigMap: 'configmaps', Secret: 'secrets', Service: 'services', Deployment: 'deployments', Job: 'jobs' };
function resourceOf(token) {
  if (RESOURCES[token]) return RESOURCES[token];
  const dot = token.indexOf('.');
  return dot > 0 ? [token.slice(0, dot), token.slice(dot + 1)] : [token, '?'];
}
function access(verb, token, name = '') {
  const [resource, group] = resourceOf(token);
  fs.appendFileSync(path.join(dir, 'access'), `${JSON.stringify({ verb, resource, group, name })}\n`);
}
if (tool === 'kubectl' && !args.includes('--dry-run=client')) {
  const named = args[2] && !args[2].startsWith('-') ? args[2] : '';
  if (args[0] === 'get') for (const t of args[1].split(',')) access(named && !args.includes('-l') ? 'get' : 'list', t, named);
  if (['create', 'replace', 'apply'].includes(args[0]) && args.includes('-f')) {
    const o = yaml.parse(fs.readFileSync(args[args.indexOf('-f') + 1], 'utf8'));
    const token = KIND_RESOURCE[o.kind] || o.kind;
    if (args[0] === 'create') access('create', token);
    if (args[0] === 'replace') access('update', token, o.metadata.name);
    if (args[0] === 'apply') { access('get', token, o.metadata.name); access('create', token); access('patch', token, o.metadata.name); }
  }
  if (args[0] === 'patch') access('patch', args[1], args[2]);
  if (args[0] === 'delete' && args.includes('--raw')) {
    const parts = args[args.indexOf('--raw') + 1].split('/');
    const group = parts[1] === 'apis' ? parts[2] : '';
    access('delete', `${parts.at(-2)}${group ? `.${group}` : ''}`, parts.at(-1));
  } else if (args[0] === 'delete') access('delete', args[1], args[2]);
  if (args[0] === 'rollout' || args[0] === 'wait') {
    const [kind, name] = args.find(a => a.includes('/') && !a.startsWith('--')).split('/');
    for (const verb of ['get', 'list', 'watch']) access(verb, kind, verb === 'get' ? name : '');
  }
  if (args[0] === 'port-forward') {
    const [kind, name] = args.find(a => /^(service|pod|deployment)\//.test(a)).split('/');
    access('get', { service: 'services', deployment: 'deployments' }[kind] || 'pods', name);
    access('list', 'pods'); access('create', 'pods/portforward');
  }
}
if (tool === 'kubectl' && args.includes('--dry-run=client') && args[0] === 'create' && args[1] === 'job') {
  access('get', 'cronjobs', args.find(a => a.startsWith('--from=')).split('/')[1]);
}
// Served types: built-in kinds plus the CRDs a test installs (apiResources).
const SERVED = ['pods', 'services', 'configmaps', 'secrets', 'endpoints', 'deployments.apps', 'replicasets.apps',
  'statefulsets.apps', 'daemonsets.apps', 'horizontalpodautoscalers.autoscaling', 'jobs.batch', 'cronjobs.batch',
  'ingresses.networking.k8s.io', 'networkpolicies.networking.k8s.io', ...(s.apiResources || [])];
if (args[0] === 'auth' && args[1] === 'can-i') {
  const sub = args.find(a => a.startsWith('--subresource='))?.split('=')[1];
  const right = `${args[2]} ${args[3].split('/')[0]}${sub ? `/${sub}` : ''}`;
  // Like the API server, can-i answers no for a type that is not served.
  const served = SERVED.includes(args[3].split('/')[0]);
  process.exit(served && !(s.deniedRights || []).includes(right) ? 0 : 1);
}
if (args[0] === 'api-resources') { out(SERVED.map(r => `${r}\n`).join('')); process.exit(); }
function crash(step, edge) {
  if (s.crash?.step === step && s.crash?.edge === edge) {
    s.crash = null; save(); process.kill(process.ppid, 'SIGKILL'); process.exit(99);
  }
}
if (tool === 'curl') {
  const url = input.find(a => /^https?:\/\//.test(a)); const route = new URL(url).pathname;
  const isClosed = s.objects.some(o => o.kind === 'Ingress' && JSON.stringify(o.spec).includes('base-maintenance-'));
  const maintenance = input[input.indexOf('-o') + 1] === '/dev/null';
  if (maintenance) { out(isClosed ? '503' : '200'); process.exit(); }
  const publicProbe = url.startsWith('https:');
  let code = 200, type = 'application/json', body = {}, headers = '';
  if (route === '/') { type = 'text/html'; body = '<html></html>'; }
  if (route === '/build.json') body = { sha: s.release.uiServedSha };
  if (route === '/health') body = { sha: s.release.apiServedSha, db: { ok: true }, objectStore: { ok: true } };
  if (route === '/api/v1/workspaces' || route === '/mcp') { code = 401; headers = 'WWW-Authenticate: Bearer realm="radar"\r\n'; }
  if (route.includes('well-known')) body = { resource: `${s.url}/mcp` };
  if (s.badSha && route === '/build.json') body.sha = 'stale';
  if (s.anonymous200 && route === '/api/v1/workspaces') code = 200;
  if (s.publicFailure && publicProbe) code = 403;
  if (s.transient && route === '/health') { code = 503; s.transient--; save(); }
  if (s.privateTransient && !publicProbe && route === '/health') { code = 503; s.privateTransient--; save(); }
  fs.writeFileSync(input[input.indexOf('-o') + 1], typeof body === 'string' ? body : JSON.stringify(body));
  if (input.includes('-D')) fs.writeFileSync(input[input.indexOf('-D') + 1], headers);
  if (input.includes('-w')) out(`${code} ${type}`);
  process.exit();
}
if (args[0] === 'config') { out(s.server || 'https://hlhedx.c1.bhs5.k8s.ovh.net'); process.exit(); }
if (args[0] === 'port-forward') {
  out(`Forwarding from 127.0.0.1:${args.includes('service/radar-ui') ? 18080 : 18848} -> service\n`);
  setInterval(() => {}, 1000); return;
}
if (args[0] === 'rollout') process.exit(s.missingMcp && args.includes('deployment/radar-immo-mcp') ? 1 : 0);
if (args[0] === 'wait') process.exit();
if (args[0] === 'get') {
  if (args[1].includes(',')) { out({ items: s.controllers || [] }); process.exit(); }
  let objects = s.objects.filter(o => o.kind === key(args[1]));
  if (key(args[1]) === 'Pod' && !args.includes('-l') && args[2]?.startsWith('-')) {
    // Schedule states observed by each full Pod listing (drain polls included).
    (s.podReads ||= []).push({ watchdog: find('cronjob', 'radar-refresh-pending-watchdog')?.spec.suspend,
      refresh: find('cronjob', 'radar-refresh-pv')?.spec.suspend }); save();
  }
  if (args[2] && !args[2].startsWith('-')) objects = objects.filter(o => o.metadata.name === args[2]);
  if (args.includes('-l')) objects = objects.filter(o => o.metadata.labels?.['job-name'] === value('-l').split('=')[1]);
  if (!objects.length && args[2] && !args[2].startsWith('-')) process.exit(args.includes('--ignore-not-found') ? 0 : 1);
  out(args[2]?.startsWith('-') || !args[2] ? { items: objects } : objects[0]); process.exit();
}
function persist(o) {
  o.metadata.uid ||= `uid-${o.kind}-${o.metadata.name}`;
  o.metadata.resourceVersion = String(Number(o.metadata.resourceVersion || 0) + 1);
  const index = s.objects.findIndex(x => x.kind === o.kind && x.metadata.name === o.metadata.name);
  if (index < 0) s.objects.push(o); else s.objects[index] = o;
}
if (args[0] === 'create' || args[0] === 'replace' || args[0] === 'apply') {
  let o = yaml.parse(fs.readFileSync(value('-f'), 'utf8'));
  if (args.includes('--dry-run=client')) { out(o); process.exit(); }
  const current = s.objects.find(x => x.kind === o.kind && x.metadata.name === o.metadata.name);
  if (args[0] === 'create' && current) process.exit(1);
  if (args[0] === 'replace' && current?.metadata.resourceVersion !== o.metadata.resourceVersion) process.exit(1);
  if (o.kind === 'Job') {
    const step = o.metadata.name.split('-').at(-1);
    crash(step, 'before-create');
    (s.jobCreation ||= []).push({ step, closed: s.objects.some(x => x.kind === 'Ingress' && JSON.stringify(x.spec).includes('base-maintenance-')),
      lockHeld: !!find('configmap', 'radar-change-lock'), preparedStatus: find('configmap', 'radar-prepared-db')?.data.status,
      watchdogSuspended: find('cronjob', 'radar-refresh-pending-watchdog')?.spec.suspend });
    // jobSeconds models real duration: the wrapper timeout (or deadline) kills a slower child.
    const limit = Number(o.spec.template.spec.containers[0].env?.find(e => e.name === 'CUTOVER_TIMEOUT')?.value ?? o.spec.activeDeadlineSeconds);
    const failed = s.failJob === step || s.jobSeconds?.[step] > limit;
    o.status = s.hangJob === step ? { active: 1 } : { conditions: [{ type: failed ? 'Failed' : 'Complete', status: 'True' }], succeeded: failed ? 0 : 1 };
    persist(o);
    persist({ kind: 'Pod', metadata: { name: `${o.metadata.name}-pod`, labels: { 'job-name': o.metadata.name },
      ownerReferences: [{ kind: 'Job', controller: true, uid: o.metadata.uid }] }, status: { phase: s.hangJob === step ? 'Running' : failed ? 'Failed' : 'Succeeded',
      containerStatuses: [{ name: 'result', state: { terminated: { message: JSON.stringify(failed ? { ok: false } : jobVerdict(step, o)) } } }] } });
  }
  if (o.kind === 'ConfigMap' && o.metadata.name === 'radar-change-lock') {
    const r = JSON.parse(o.data.record);
    for (const [step, checkpoint] of Object.entries(r.checkpoints)) {
      crash(step, `before-${checkpoint}`);
    }
  }
  persist(o); save(); out(o);
  if (s.apiLostAfterRestore && o.kind === 'Job' && o.metadata.name.endsWith('-restore')) { s.apiLost = true; save(); }
  if (o.kind === 'Job') crash(o.metadata.name.split('-').at(-1), 'after-create');
  if (o.kind === 'ConfigMap' && o.metadata.name === 'radar-change-lock') {
    const r = JSON.parse(o.data.record);
    for (const [step, checkpoint] of Object.entries(r.checkpoints)) crash(step, `after-${checkpoint}`);
  }
  if (s.crashAfterRestore && o.kind === 'Job' && o.metadata.name.endsWith('-restore')) process.kill(process.ppid, 'SIGKILL');
  process.exit();
}
if (args[0] === 'patch') {
  const o = find(args[1], args[2]); if (!o) process.exit(1);
  const patch = JSON.parse(value('-p'));
  if (o.kind === 'Ingress' && s.ingressConflict === o.metadata.name &&
    patch.some(p => p.op === 'replace' && p.path === '/spec' && !JSON.stringify(p.value).includes('base-maintenance-'))) process.exit(1);
  if (args.includes('--type=merge')) Object.assign(o.data, patch.data);
  else for (const op of patch) {
    const parts = op.path.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
    const last = parts.pop(); let parent = o; for (const p of parts) parent = parent[p];
    if (op.op === 'test' && JSON.stringify(parent[last]) !== JSON.stringify(op.value)) {
      // Same 422 rendering as kubectl for a failed JSON-patch test operation.
      process.stderr.write('The request is invalid: the server rejected our request due to an error in our request\n'); process.exit(1);
    }
    if (op.op === 'remove') delete parent[last];
    if (op.op === 'add' || op.op === 'replace') parent[last] = op.value;
  }
  if (o.kind === 'Deployment') {
    o.metadata.generation = (o.metadata.generation || 1) + 1;
    o.status = { replicas: o.spec.replicas, readyReplicas: o.spec.replicas, updatedReplicas: o.spec.replicas,
      availableReplicas: o.spec.replicas, observedGeneration: o.metadata.generation };
    s.objects = s.objects.filter(p => !(p.kind === 'Pod' && p.metadata.name === `${o.metadata.name}-consumer`));
    const endpoint = find('endpoints', o.metadata.name);
    if (endpoint) endpoint.subsets = o.spec.replicas ? [{ addresses: [{ ip: '10.0.0.1' }] }] : [];
  }
  persist(o); save(); out(o);
  if (o.kind === 'Secret') crash('switch', 'after-patch');
  process.exit();
}
if (args[0] === 'delete') {
  const raw = args.includes('--raw'); const name = raw ? value('--raw').split('/').at(-1) : args[2];
  const kind = raw ? key(value('--raw').split('/').at(-2)) : key(args[1]);
  const o = s.objects.find(x => x.kind === kind && x.metadata.name === name);
  if (o && raw && JSON.parse(fs.readFileSync(value('-f'))).preconditions.uid !== o.metadata.uid) process.exit(1);
  s.objects = s.objects.filter(x => x !== o && !x.metadata.ownerReferences?.some(r => r.uid === o?.metadata.uid));
  save(); process.exit();
}
process.stderr.write('Unsupported fake call'); process.exit(91);
