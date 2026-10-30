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
  ingress: 'Ingress', ingresses: 'Ingress', endpoints: 'Endpoints', replicasets: 'ReplicaSet', networkpolicy: 'NetworkPolicy', secret: 'Secret',
  pvc: 'PersistentVolumeClaim', resourcequotas: 'ResourceQuota' })[kind];
const find = (kind, name) => s.objects.find(o => o.kind === key(kind) && o.metadata.name === name);
const value = flag => args[args.indexOf(flag) + 1];
const envOf = (job, name) => job.spec.template.spec.containers[0].env?.find(e => e.name === name)?.value;
const jobVerdict = (step, job) => step === 'tplseal' ? { ok: true, sizeBytes: 281512198 }
  : step === 'freeze' ? (s.frozenAt = new Date().toISOString(), save(), { ok: true, freezeStartedAt: s.frozenAt, frozenAt: s.frozenAt })
  : step.startsWith('unfreeze') ? (s.unfrozen = (s.unfrozen || 0) + 1, save(), { ok: true, unfrozenAt: new Date().toISOString() })
  : step.startsWith('volume') ? { ok: true, volumeUsedBytes: 4000000000, liveDbBytes: 3000000000, walBytes: 1000000000, ...s.volume }
  : step === 'probeverify' ? { ok: true, probe: s.probeRanges || { radar: [], radar_next: [] } }
  : step.startsWith('logs') ? { ok: true, podUids: JSON.parse(envOf(job, 'LOG_PODS')).map(p => p.uid).slice(s.logsMissing ? 1 : 0) }
  : ['database', 'identity', 'destination', 'clone', 'tplreset', 'discard'].includes(step)
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
  services: ['services', ''], pods: ['pods', ''], 'pods/portforward': ['pods/portforward', ''], 'pods/exec': ['pods/exec', ''], endpoints: ['endpoints', ''], deployment: ['deployments', 'apps'],
  deployments: ['deployments', 'apps'], replicasets: ['replicasets', 'apps'], statefulsets: ['statefulsets', 'apps'],
  daemonsets: ['daemonsets', 'apps'], horizontalpodautoscalers: ['horizontalpodautoscalers', 'autoscaling'],
  job: ['jobs', 'batch'], jobs: ['jobs', 'batch'], cronjob: ['cronjobs', 'batch'], cronjobs: ['cronjobs', 'batch'],
  ingress: ['ingresses', 'networking.k8s.io'], ingresses: ['ingresses', 'networking.k8s.io'],
  networkpolicy: ['networkpolicies', 'networking.k8s.io'], pvc: ['persistentvolumeclaims', ''],
  endpointslices: ['endpointslices', 'discovery.k8s.io'], resourcequotas: ['resourcequotas', ''] };
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
if (args[0] === 'auth' && args[1] === 'can-i') {
  const sub = args.find(a => a.startsWith('--subresource='))?.split('=')[1];
  const right = `${args[2]} ${args[3].split('/')[0]}${sub ? `/${sub}` : ''}`;
  process.exit((s.deniedRights || []).includes(right) ? 1 : 0);
}
if (args[0] === 'api-resources') { out((s.apiResources || []).map(r => `${r}\n`).join('')); process.exit(); }
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
  // Builds are served by the Pods behind the route: public routes through the canonical Services,
  // private ones through the forwarded resource (a UI proxies /health to its slot's API Service).
  const podsOf = resource => {
    const [kind, name] = resource.split('/');
    const running = p => p.kind === 'Pod' && p.status?.phase === 'Running' && !s.unready?.includes(p.metadata.labels?.['sentropic.io/slot']);
    if (kind === 'service') {
      const selector = find('service', name)?.spec.selector;
      if (!selector) return undefined;
      return s.objects.filter(p => running(p) && Object.entries(selector).every(([k, v]) => p.metadata.labels?.[k] === v));
    }
    const d = find('deployment', name);
    if (!d) return undefined;
    const sets = s.objects.filter(r => r.kind === 'ReplicaSet' && r.metadata.ownerReferences?.some(o => o.uid === d.metadata.uid)).map(r => r.metadata.uid);
    return s.objects.filter(p => running(p) && p.metadata.ownerReferences?.some(o => sets.includes(o.uid)));
  };
  const port = /^https?:\/\/127\.0\.0\.1:(\d+)/.exec(url)?.[1];
  const forwarded = port && fs.existsSync(path.join(dir, `forward-${port}`)) ? fs.readFileSync(path.join(dir, `forward-${port}`), 'utf8') : null;
  let resource = publicProbe ? (route === '/health' ? 'service/radar-api' : 'service/radar-ui') : forwarded;
  if (resource && route === '/health' && /radar-ui/.test(resource)) resource = /prepared/.test(resource) ? 'service/radar-api-prepared' : 'service/radar-api';
  if (resource && (route === '/health' || route === '/build.json')) {
    const pods = podsOf(resource);
    if (pods && !pods.length) code = 503;
    const image = pods?.[0]?.status.containerStatuses?.[0]?.imageID;
    if (s.preparedStale && publicProbe && route === '/build.json' && pods?.[0]?.metadata.labels?.['sentropic.io/slot'] === 'prepared') body.sha = 'stale';
    if (image && s.previousSha && image !== s.release.apiImage && image !== s.release.uiImage) {
      body.sha = route === '/health' ? s.previousSha : s.previousSha.slice(0, 7);
    }
  }
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
  // One local port per forwarded resource; curl resolves it back to the serving Pods.
  const resource = args.find(a => /^(service|pod|deployment)\//.test(a));
  const port = 20000 + [...resource].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 20000, 7);
  fs.writeFileSync(path.join(dir, `forward-${port}`), resource);
  out(`Forwarding from 127.0.0.1:${port} -> ${resource}\n`);
  setInterval(() => {}, 1000); return;
}
if (args[0] === 'rollout') process.exit(s.missingMcp && args.includes('deployment/radar-immo-mcp') ? 1 : 0);
if (args[0] === 'wait') process.exit();
if (args[0] === 'get') {
  if (args[1].includes(',')) { out({ items: s.controllers || [] }); process.exit(); }
  if (args[1] === 'endpointslices') { out(slicesOf(find('service', value('-l').split('=')[1]))); process.exit(); }
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
// A Deployment write replaces its ReplicaSet and Pods; Pods carry the template labels and images.
function rollout(d) {
  const owned = s.objects.filter(r => r.kind === 'ReplicaSet' && r.metadata.ownerReferences?.some(x => x.uid === d.metadata.uid))
    .map(r => r.metadata.uid);
  s.objects = s.objects.filter(x => !owned.includes(x.metadata.uid)
    && !(x.kind === 'Pod' && x.metadata.ownerReferences?.some(r => owned.includes(r.uid))));
  if (!d.spec.replicas) return;
  const generation = s.rolloutSeq = (s.rolloutSeq || 0) + 1;
  const rs = { kind: 'ReplicaSet', metadata: { name: `${d.metadata.name}-rs${generation}`, uid: `uid-rs-${generation}`,
    labels: d.spec.template.metadata?.labels || {}, ownerReferences: [{ kind: 'Deployment', controller: true, uid: d.metadata.uid }] },
  spec: { selector: d.spec.selector, template: d.spec.template } };
  s.objects.push(rs);
  for (let i = 0; i < d.spec.replicas; i++) {
    s.objects.push({ kind: 'Pod', metadata: { name: `${d.metadata.name}-pod${generation}-${i}`, uid: `uid-pod-${generation}-${i}`,
      labels: { ...(d.spec.template.metadata?.labels || {}), 'pod-template-hash': `h${generation}` },
      ownerReferences: [{ kind: 'ReplicaSet', controller: true, uid: rs.metadata.uid, name: rs.metadata.name }] },
    spec: { containers: d.spec.template.spec.containers },
    // The kubelet reports the resolved digest, also for a tag reference.
    status: { phase: 'Running', containerStatuses: d.spec.template.spec.containers.map(c => ({ name: c.name, ready: true,
      imageID: c.image.includes('@sha256:') ? c.image : `${c.image.replace(/:[^:@/]+$/, '')}@sha256:${'0'.repeat(64)}` })) } });
  }
}
// EndpointSlices are derived from the Service selector and the Running Pods.
function slicesOf(service) {
  const selector = service?.spec.selector || {};
  const pods = s.objects.filter(p => p.kind === 'Pod' && p.status?.phase === 'Running' && !s.unready?.includes(p.metadata.labels?.['sentropic.io/slot'])
    && Object.entries(selector).every(([k, v]) => p.metadata.labels?.[k] === v));
  return { items: [{ endpoints: pods.map(p => ({ targetRef: { kind: 'Pod', name: p.metadata.name, uid: p.metadata.uid }, conditions: { ready: true } })) }] };
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
  if (o.kind === 'Deployment' && !current) {
    o.metadata.generation = 1;
    o.status = { replicas: o.spec.replicas, readyReplicas: o.spec.replicas, updatedReplicas: o.spec.replicas,
      availableReplicas: o.spec.replicas, observedGeneration: 1 };
  }
  persist(o);
  if (o.kind === 'Deployment' && !current) {
    rollout(o);
    (s.created ||= []).push({ name: o.metadata.name, db: o.spec.template.spec.containers[0].env?.find(e => e.name === 'POSTGRES_DB')?.value });
  }
  save(); out(o);
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
  if (o.kind === 'Service' && s.serviceConflict === o.metadata.name && (!s.conflictTo || patch.at(-1).value === s.conflictTo)) process.exit(1);
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
    rollout(o);
    const endpoint = find('endpoints', o.metadata.name);
    if (endpoint) endpoint.subsets = o.spec.replicas ? [{ addresses: [{ ip: '10.0.0.1' }] }] : [];
  }
  if (o.kind === 'PersistentVolumeClaim') o.status = s.pvcResize === 'pending'
    ? { capacity: o.status?.capacity, conditions: [{ type: 'FileSystemResizePending', status: 'True' }] }
    : { capacity: { storage: o.spec.resources.requests.storage } };
  persist(o); save(); out(o);
  if (o.kind === 'Secret') crash('switch', 'after-patch');
  process.exit();
}
if (args[0] === 'delete') {
  const raw = args.includes('--raw'); const name = raw ? value('--raw').split('/').at(-1) : args[2];
  const kind = raw ? key(value('--raw').split('/').at(-2)) : key(args[1]);
  const o = s.objects.find(x => x.kind === kind && x.metadata.name === name);
  if (o && raw && JSON.parse(fs.readFileSync(value('-f'))).preconditions.uid !== o.metadata.uid) process.exit(1);
  (s.deletions ||= []).push({ kind, name });
  if (o && raw && JSON.parse(fs.readFileSync(value('-f'))).propagationPolicy === 'Orphan') {
    for (const x of s.objects) if (x.metadata.ownerReferences) x.metadata.ownerReferences = x.metadata.ownerReferences.filter(r => r.uid !== o.metadata.uid);
    s.objects = s.objects.filter(x => x !== o);
  } else if (o) {
    const gone = new Set([o.metadata.uid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const x of s.objects) if (!gone.has(x.metadata.uid) && x.metadata.ownerReferences?.some(r => gone.has(r.uid))) { gone.add(x.metadata.uid); grew = true; }
    }
    s.objects = s.objects.filter(x => x !== o && !gone.has(x.metadata.uid));
  }
  save(); process.exit();
}
process.stderr.write('Unsupported fake call'); process.exit(91);
