// Stateful Kubernetes/HTTP double. Invoked only by isolated controller tests.
/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const process = require('node:process');
const { setInterval } = require('node:timers');
const fs = require('node:fs');
const yaml = require('yaml');
const path = require('node:path');
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
const out = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
const key = kind => ({ configmap: 'ConfigMap', configmaps: 'ConfigMap', deployment: 'Deployment', deployments: 'Deployment',
  job: 'Job', jobs: 'Job', pods: 'Pod', service: 'Service', services: 'Service', cronjob: 'CronJob', cronjobs: 'CronJob',
  ingress: 'Ingress', ingresses: 'Ingress', endpoints: 'Endpoints', replicasets: 'ReplicaSet', networkpolicy: 'NetworkPolicy' })[kind];
const find = (kind, name) => s.objects.find(o => o.kind === key(kind) && o.metadata.name === name);
const value = flag => args[args.indexOf(flag) + 1];
const jobVerdict = step => step === 'resolve' ? { ok: true, date: '2026-10-29', backupId: 'latest',
  manifestSha256: 'd'.repeat(64), pgSha256: 'e'.repeat(64), pgSizeBytes: 1024 } : step === 'data' ?
  { ok: true, status: 'open-success', epoch: 'scoped', sealedUnresolved: 0, maintenanceBarrier: false } : { ok: true };
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
  fs.writeFileSync(input[input.indexOf('-o') + 1], typeof body === 'string' ? body : JSON.stringify(body));
  if (input.includes('-D')) fs.writeFileSync(input[input.indexOf('-D') + 1], headers);
  if (input.includes('-w')) out(`${code} ${type}`);
  process.exit();
}
if (args[0] === 'config') { out(s.server || 'https://hlhedx.c1.bhs5.k8s.ovh.net'); process.exit(); }
if (args[0] === 'api-resources') process.exit();
