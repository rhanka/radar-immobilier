// Daily restore incident 2026-10-31 (run 41191888332): a wildcard artifact Ingress
// kept the closure probe failing and the failed run left preprod closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';
const lock = f => f.state().objects.find(o => o.metadata.name === 'radar-change-lock');
const record = f => JSON.parse(lock(f).data.record);
const save = (f, state) => writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
const jobs = (f, step) => f.state().objects.filter(o => o.kind === 'Job' && o.metadata.name.endsWith(`-${step}`));
function addArtifactIngress(f) {
  const state = f.state();
  state.objects.push({ apiVersion: 'v1', kind: 'Ingress', metadata: { name: 'radar-artifact-content', uid: 'uid-artifact', resourceVersion: '1' },
    spec: { ingressClassName: 'traefik', rules: ['*.preprod.immo-pages.sent-tech.ca', '*.pinned.preprod.immo-pages.sent-tech.ca'].map(host => ({ host,
      http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'radar-api', port: { name: 'http' } } } }] } })) } });
  save(f, state);
}
function assertReopened(f, originals) {
  const objects = f.state().objects;
  assert.equal(lock(f), undefined, 'lock released after reopening');
  for (const ingress of objects.filter(o => o.kind === 'Ingress')) assert.deepEqual(ingress.spec, originals[ingress.metadata.name]);
  for (const name of ['radar-api', 'radar-ui', 'radar-immo-mcp']) assert.equal(objects.find(o => o.metadata.name === name).spec.replicas, 1);
  assert.equal(objects.find(o => o.metadata.name === 'radar-refresh-pv').spec.suspend, false);
  assert.equal(objects.find(o => o.metadata.name === 'originally-suspended').spec.suspend, true);
  assert.equal(objects.some(o => o.kind === 'Service' && o.metadata.name.startsWith('base-maintenance-')), false);
  assert.equal(objects.some(o => o.metadata.name === 'radar-cutover-receipt'), false, 'no receipt for an unserved pin');
  const verify = jobs(f, 'verify').at(-1);
  assert.ok(verify, 'live database verified before reopening');
  const env = Object.fromEntries(verify.spec.template.spec.containers[0].env.map(e => [e.name, e.value]));
  assert.equal(env.CUTOVER_DB_OPERATION, 'destination');
  assert.equal(env.TARGET_DB, env.POSTGRES_DB);
}
const ingresses = f => Object.fromEntries(f.state().objects.filter(o => o.kind === 'Ingress').map(o => [o.metadata.name, o.spec]));
function githubExecutor(f, run = '41191888332') {
  const state = f.state();
  const cm = state.objects.find(o => o.metadata.name === 'radar-change-lock');
  const r = JSON.parse(cm.data.record);
  r.executor = { kind: 'github', repo: 'rhanka/radar-immobilier', run, attempt: '1', job: 'bascule', state: 'running' };
  cm.data.record = JSON.stringify(r); save(f, state);
  writeFileSync(join(f.dir, 'bin', 'gh'), `#!/bin/sh\necho "$*" >> '${f.dir}/gh-calls'\necho "\${GH_JOB_STATUS:-completed}"\n`, { mode: 0o755 });
  return r.run;
}
const operator = (f, action, extra, env) => spawnSync('make', ['-s', '-f', 'deploy/cutover/operator.mk', action, ...extra, 'ENV=preprod'],
  { env: { ...f.env, ...env }, encoding: 'utf8', timeout: 240000 });

test('wildcard artifact Ingress host closes and the daily restore completes', () => {
  const f = fixture({ fastClock: true });
  try {
    addArtifactIngress(f);
    const originals = ingresses(f);
    const result = f.run('run', ['RELEASE=deployed', 'MODE=restore']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('SUCCESS:'));
    assert.deepEqual(ingresses(f), originals);
    const probed = f.calls().filter(c => c[0] === 'curl').flat();
    assert.ok(probed.includes('https://cutover-probe.preprod.immo-pages.sent-tech.ca/'));
    assert.ok(probed.includes('https://cutover-probe.pinned.preprod.immo-pages.sent-tech.ca/'));
    assert.equal(probed.some(a => a.includes('*')), false);
  } finally { f.cleanup(); }
});
test('closure failure of a daily restore reopens on the verified previous database (trap)', () => {
  const f = fixture({ fastClock: true, maintenanceUnproven: true });
  try {
    const originals = ingresses(f);
    const result = f.run('run', ['RELEASE=deployed', 'MODE=restore']);
    assert.notEqual(result.status, 0, 'the workflow still reports the failed restore');
    assert.ok(result.stderr.includes('Closure deadline exceeded (public maintenance probe)'), result.stderr);
    assert.ok(result.stdout.includes('REOPENED WITHOUT RESTORE'), result.stdout + result.stderr);
    assert.equal(jobs(f, 'restore').length, 0, 'the live database was never restored');
    assertReopened(f, originals);
  } finally { f.cleanup(); }
});
test('failed atomic restore reopens on the intact database without migrations (trap)', () => {
  const f = fixture({ failJob: 'restore' });
  try {
    const originals = ingresses(f);
    const result = f.run('run', ['RELEASE=deployed', 'MODE=restore']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stdout.includes('REOPENED WITHOUT RESTORE'), result.stdout + result.stderr);
    assert.equal(jobs(f, 'ddl').length, 0);
    assertReopened(f, originals);
  } finally { f.cleanup(); }
});
test('refused live database verification keeps the daily restore closed for recovery', () => {
  const f = fixture({ failJobs: ['ddl', 'verify'] });
  try {
    const result = f.run('run', ['RELEASE=deployed', 'MODE=restore']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Automatic reopening refused'), result.stderr);
    assert.ok(lock(f)); assert.equal(record(f).executor.state, 'stopped');
    assert.ok(JSON.stringify(f.state().objects.find(o => o.kind === 'Ingress').spec).includes('base-maintenance-'));
    assert.equal(f.state().objects.find(o => o.metadata.name === 'radar-refresh-pv').spec.suspend, true);
    // Explicit rollback re-verifies under a new Job name once the database is consistent.
    const state = f.state(); state.failJobs = []; save(f, state);
    const run = record(f).run;
    const rollback = f.run('rollback', [`RUN=${run}`]);
    assert.equal(rollback.status, 0, rollback.stdout + rollback.stderr);
    assert.equal(lock(f), undefined);
    const names = jobs(f, 'verify').map(j => j.metadata.name);
    assert.equal(names.length, 2); assert.ok(names.includes(`cutover-${run}-verify`));
    assert.ok(names.some(n => new RegExp(`^cutover-${run}-[0-9]+-verify$`).test(n)), names.join());
  } finally { f.cleanup(); }
});
test('rollback reopens a daily restore left closed by a lost GitHub executor', () => {
  const f = fixture({ crash: { step: 'restore', edge: 'before-create' } });
  try {
    const originals = ingresses(f);
    assert.notEqual(f.run('run', ['RELEASE=deployed', 'MODE=restore']).status, 0);
    assert.ok(JSON.stringify(f.state().objects.find(o => o.kind === 'Ingress').spec).includes('base-maintenance-'), 'left closed');
    const run = githubExecutor(f);
    const active = operator(f, 'rollback', [`RUN=${run}`], { GH_JOB_STATUS: 'in_progress' });
    assert.notEqual(active.status, 0); assert.ok(active.stderr.includes('cannot be proved ended'), active.stderr);
    assert.ok(lock(f));
    const result = operator(f, 'rollback', [`RUN=${run}`], {});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('REOPENED WITHOUT RESTORE'));
    assertReopened(f, originals);
  } finally { f.cleanup(); }
});
test('same-workflow recover job reopens only its own lost daily restore', () => {
  const f = fixture({ crash: { step: 'restore', edge: 'before-create' } });
  try {
    const originals = ingresses(f);
    assert.notEqual(f.run('run', ['RELEASE=deployed', 'MODE=restore']).status, 0);
    githubExecutor(f, '41191888332');
    const github = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'rhanka/radar-immobilier', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'recover' };
    const foreign = operator(f, 'recover', [], { ...github, GITHUB_RUN_ID: '1' });
    assert.equal(foreign.status, 0); assert.ok(foreign.stdout.includes('nothing to recover'));
    assert.ok(lock(f));
    const result = operator(f, 'recover', [], { ...github, GITHUB_RUN_ID: '41191888332' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assertReopened(f, originals);
    assert.match(readFileSync(join(f.dir, 'gh-calls'), 'utf8'), /runs\/41191888332\/attempts\/1\/jobs/);
    const again = operator(f, 'recover', [], { ...github, GITHUB_RUN_ID: '41191888332' });
    assert.equal(again.status, 0); assert.ok(again.stdout.includes('No active change operation'));
  } finally { f.cleanup(); }
});
