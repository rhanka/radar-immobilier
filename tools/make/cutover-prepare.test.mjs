import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';
import { Buffer } from 'node:buffer';
const clone = value => JSON.parse(JSON.stringify(value));
const success = r => assert.equal(r.status, 0, r.stdout + r.stderr);
const object = (f, name) => f.state().objects.find(o => o.metadata.name === name);
const save = (f, state) => writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
test('prepare stamps ready without closing live services and releases the lock during restore', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const stamp = object(f, 'radar-prepared-db').data;
    assert.equal(stamp.status, 'ready'); assert.equal(stamp.smoke, 'pass');
    assert.equal(stamp.gitSha, f.release.gitSha); assert.equal(stamp.targetDb, 'radar_next');
    assert.equal(stamp.migrations, '25');
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar').toString('base64'));
    assert.equal(object(f, 'radar-change-lock'), undefined);
    assert.equal(object(f, 'radar-api-prepared').spec.template.metadata.labels['sentropic.io/slot'], 'prepared');
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    const restore = f.state().jobCreation.find(j => j.step === 'restore');
    assert.deepEqual([restore.closed, restore.lockHeld, restore.preparedStatus, restore.watchdogSuspended], [false, false, 'preparing', true]);
    for (const job of f.state().objects.filter(o => o.kind === 'Job' && /-(restore|ddl|data)$/.test(o.metadata.name))) {
      const env = job.spec.template.spec.containers[0].env;
      const restore = job.metadata.name.endsWith('-restore');
      // No staged template yet: the backup is restored into the template, then cloned.
      assert.equal(env.find(e => e.name === 'POSTGRES_DB').value, restore ? 'radar_tpl' : 'radar_next');
      if (restore) {
        assert.equal(env.find(e => e.name === 'PGDATABASE').value, 'radar_tpl');
        assert.deepEqual(['RESTORE_JOBS', 'RESTORE_TUNED'].map(n => env.find(e => e.name === n).value), ['2', '1']);
        assert.equal(env.find(e => e.name === 'LIVE_DB').value, 'radar');
        assert.deepEqual(job.spec.template.spec.containers[0].resources,
          { requests: { cpu: '250m', memory: '1Gi' }, limits: { cpu: '1500m', memory: '2Gi' } });
      }
      if (job.metadata.name.endsWith('-data')) {
        const evidence = JSON.parse(env.find(e => e.name === 'CUTOVER_EVIDENCE').value);
        const pods = f.state().objects.filter(o => o.kind === 'Pod' && /-(clone|ddl)-pod$/.test(o.metadata.name));
        assert.deepEqual(evidence.instances.sort(), pods.map(p => p.metadata.uid).sort());
        assert.equal(evidence.instances.length, 2);
      }
    }
    const before = f.state().jobCreation.length;
    success(f.run('run', ['MODE=run']));
    assert.ok(f.state().jobCreation.slice(before).every(j => !['restore', 'ddl', 'data', 'docs', 'backup'].includes(j.step)));
    const receipt = JSON.parse(object(f, 'radar-cutover-receipt').data.receipt);
    assert.equal(receipt.recoveryReference, 'postgres://radar-postgres/radar');
    const patches = f.calls().filter(c => c.includes('patch') && c.includes('secret'));
    assert.equal(patches.length, 1);
    assert.ok(JSON.parse(patches[0][patches[0].indexOf('-p') + 1]).every(p => p.path === '/data/POSTGRES_DB'));
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar_next').toString('base64'));
    assert.equal(object(f, 'radar-refresh-pending-watchdog').spec.suspend, false);
    assert.equal(object(f, 'originally-suspended').spec.suspend, true);
  } finally { f.cleanup(); }
});
for (const step of ['restore', 'ddl', 'data']) test(`prepare fails pipeline and discards target on ${step} failure`, () => {
  const f = fixture({ failJob: step });
  try {
    assert.notEqual(f.run('prepare').status, 0);
    assert.equal(object(f, 'radar-prepared-db').data.status, 'failed');
    // The disposable target exists only once cloned; a failed staging marks the template failed.
    assert.equal(f.state().jobCreation.some(j => j.step === 'discard'), step !== 'restore');
    if (step === 'restore') assert.equal(object(f, 'radar-template-db').data.status, 'failed');
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    assert.equal(object(f, 'radar-api').spec.replicas, 1);
    assert.equal(f.state().jobCreation.some(j => j.closed), false);
  } finally { f.cleanup(); }
});
test('prepared smoke failure fails preparation and leaves live database selected', () => {
  const f = fixture({ anonymous200: true });
  try {
    assert.notEqual(f.run('prepare').status, 0);
    assert.equal(object(f, 'radar-prepared-db').data.status, 'failed');
    assert.equal(object(f, 'radar-api-prepared'), undefined);
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar').toString('base64'));
  } finally { f.cleanup(); }
});
test('cutover refuses stale and mismatched prepared stamps before closure', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const original = clone(f.state());
    for (const change of [{ preparedAt: '2020-01-01T00:00:00Z' }, { gitSha: 'f'.repeat(40) },
      { manifestSha256: 'f'.repeat(64) }, { pgSha256: 'f'.repeat(64) }, { status: 'preparing' }, { targetDb: 'radar' },
      { recoveryReference: '' }]) {
      const state = clone(original);
      Object.assign(state.objects.find(o => o.metadata.name === 'radar-prepared-db').data, change); save(f, state);
      assert.notEqual(f.run('run', ['MODE=run']).status, 0, JSON.stringify(change));
      assert.equal(JSON.stringify(object(f, 'application').spec).includes('base-maintenance-'), false);
      assert.equal(object(f, 'radar-api').spec.replicas, 1);
      assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    }
    for (const pinOverride of [{ ageHours: 27 }, { date: '2026-10-30' }]) {
      const state = clone(original); state.pinOverride = pinOverride; save(f, state);
      assert.notEqual(f.run('run', ['MODE=run']).status, 0);
      assert.equal(JSON.stringify(object(f, 'application').spec).includes('base-maintenance-'), false);
    }
  } finally { f.cleanup(); }
});
test('rollback patches the previous database and previous images after failed cutover', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const state = f.state(); state.missingMcp = true; save(f, state);
    assert.notEqual(f.run('run', ['MODE=run']).status, 0);
    const record = JSON.parse(object(f, 'radar-change-lock').data.record);
    const recovery = f.state(); recovery.missingMcp = false; save(f, recovery);
    success(f.run('rollback', [`RUN=${record.run}`, 'MODE=run']));
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar').toString('base64'));
    assert.equal(f.calls().filter(c => c.includes('patch') && c.includes('secret')).length, 2);
  } finally { f.cleanup(); }
});
test('production prepares a recovery backup and cutover changes images without restore or migration', () => {
  const f = fixture({ url: 'https://immo.sent-tech.ca' });
  try {
    const state = f.state();
    const ingress = state.objects.find(o => o.kind === 'Ingress');
    ingress.spec.rules[0].host = 'immo.sent-tech.ca'; ingress.spec.tls[0].hosts = ['immo.sent-tech.ca'];
    save(f, state);
    success(f.run('prepare', [], 'prod'));
    assert.equal(object(f, 'radar-prepared-db').data.targetDb, 'radar');
    success(f.run('run', ['MODE=run'], 'prod'));
    const steps = f.state().jobCreation.map(j => j.step);
    assert.equal(steps.filter(s => s === 'backup').length, 1);
    assert.ok(steps.indexOf('probe') >= 0 && steps.indexOf('probe') < steps.indexOf('backup'));
    const backup = f.state().objects.find(o => o.kind === 'Job' && o.metadata.name.endsWith('-backup'));
    assert.ok(JSON.stringify(backup.spec).includes('s3://sentropic-pgbackup/db-backups/cutover-prod-'));
    const prepareRun = JSON.parse(object(f, 'radar-prepared-db').data.record).run;
    assert.equal(JSON.parse(object(f, 'radar-cutover-receipt').data.receipt).recoveryReference,
      `s3://sentropic-pgbackup/db-backups/cutover-prod-${prepareRun}.sql.gz`);
    assert.ok(steps.every(s => !['restore', 'ddl', 'data', 'docs', 'recon'].includes(s)));
    assert.equal(f.calls().some(c => c.includes('patch') && c.includes('secret')), false);
  } finally { f.cleanup(); }
});
const refreshJob = (name, status) => ({ kind: 'Job', metadata: { name, uid: `${name}-uid`,
  ownerReferences: [{ kind: 'CronJob', controller: true, uid: 'uid-radar-refresh-pv' }] }, status });
const refreshPod = (job, phase, reason) => ({ kind: 'Pod', metadata: { name: `${job}-pod`, uid: `${job}-pod-uid`,
  labels: { 'job-name': job }, ownerReferences: [{ kind: 'Job', controller: true, uid: `${job}-uid` }] },
  status: { phase, containerStatuses: [{ name: 'refresh-pv', state: reason ? { terminated: { reason } } : { running: {} } }] } });
const drainReads = f => (f.state().podReads || []).filter(r => r.watchdog === true && r.refresh === true);
test('prepare drains owned refresh for at most ten minutes without killing it', () => {
  const f = fixture({ fastClock: true });
  try {
    const state = f.state();
    state.objects.push(refreshJob('draining-refresh', { active: 1 }), refreshPod('draining-refresh', 'Running'));
    save(f, state);
    const result = f.run('prepare');
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('drain exceeded ten minutes'), result.stderr);
    assert.ok(result.stderr.includes('Pod/draining-refresh-pod(Running)'), result.stderr);
    assert.equal(object(f, 'radar-prepared-db').data.status, 'failed');
    // Every drain poll ran with the watchdog and the refresh schedule suspended...
    assert.ok(drainReads(f).length >= 10, JSON.stringify(f.state().podReads));
    // ...and the failure restored each schedule to its original state.
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    assert.equal(object(f, 'radar-refresh-pending-watchdog').spec.suspend, false);
    assert.equal(object(f, 'originally-suspended').spec.suspend, true);
    assert.equal(f.state().jobCreation.some(j => j.step === 'docs'), false);
    assert.equal(f.calls().some(c => c.includes('delete') && c.some(a => a.endsWith('/jobs/draining-refresh'))), false);
  } finally { f.cleanup(); }
});
test('prepare drain ignores terminated writer Pods (Error/Completed) and waits for a writer Job without Pod', () => {
  const f = fixture({ fastClock: true });
  try {
    const state = f.state();
    // Preprod 2026-10-30: Failed refresh Job with its Error Pod, a refresh Job whose Pod ended in Error
    // before the Job controller set a terminal condition, and a Completed watchdog run.
    state.objects.push(
      refreshJob('refresh-failed', { conditions: [{ type: 'Failed', status: 'True' }], failed: 1 }),
      refreshPod('refresh-failed', 'Failed', 'Error'),
      refreshJob('refresh-ended', { failed: 1 }), refreshPod('refresh-ended', 'Failed', 'Error'),
      { ...refreshJob('watchdog-done', { conditions: [{ type: 'Complete', status: 'True' }], succeeded: 1 }),
        metadata: { name: 'watchdog-done', uid: 'watchdog-done-uid',
          ownerReferences: [{ kind: 'CronJob', controller: true, uid: 'uid-radar-refresh-pending-watchdog' }] } },
      refreshPod('watchdog-done', 'Succeeded', 'Completed'));
    save(f, state);
    success(f.run('prepare'));
    assert.equal(object(f, 'radar-prepared-db').data.status, 'ready');
    assert.equal(f.state().jobCreation.find(j => j.step === 'docs').watchdogSuspended, true);
    assert.ok(drainReads(f).length >= 1);
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    assert.equal(object(f, 'radar-refresh-pending-watchdog').spec.suspend, false);
    assert.equal(object(f, 'originally-suspended').spec.suspend, true);
    assert.equal(f.calls().some(c => c.includes('delete') && c.some(a => /\/jobs\/(refresh|watchdog)-/.test(a))), false);
  } finally { f.cleanup(); }
  const g = fixture({ fastClock: true });
  try {
    const state = g.state();
    state.objects.push(refreshJob('refresh-starting', {}));
    save(g, state);
    const result = g.run('prepare');
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Job/refresh-starting(PodNotCreated)'), result.stderr);
    assert.equal(object(g, 'radar-refresh-pending-watchdog').spec.suspend, false);
  } finally { g.cleanup(); }
});
test('resume reconciles a database switch whose checkpoint response was lost', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const state = f.state(); state.crash = { step: 'switch', edge: 'after-patch' }; save(f, state);
    assert.notEqual(f.run('run', ['MODE=run']).status, 0);
    const record = JSON.parse(object(f, 'radar-change-lock').data.record);
    assert.equal(record.checkpoints.switch, 'started');
    success(f.run('resume', [`RUN=${record.run}`]));
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar_next').toString('base64'));
    assert.equal(f.state().jobCreation.filter(j => j.step === 'restore').length, 1);
    assert.equal(object(f, 'radar-change-lock'), undefined);
  } finally { f.cleanup(); }
});
test('budget exhaustion after closure rolls back automatically and reopens', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    // The first private health probe after closure stalls; recovery probes pass.
    const state = f.state(); state.privateTransient = 1; save(f, state);
    const ingress = clone(object(f, 'application').spec);
    // Time jumps only once the closure-started budget exists and the stalled probe was served.
    f.env['BASH_FUNC_sleep%%'] = '() { if [ -n "${FAST_DEADLINE:-}" ] && grep -q \'"privateTransient":0\' "$CUTOVER_TEST_STATE/state.json"; then SECONDS=$((SECONDS+300)); else command sleep "$@"; fi; }';
    const result = f.run('run', ['MODE=run']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('automatic rollback'), result.stderr);
    assert.ok(result.stdout.includes('Rollback recovery reference: postgres://radar-postgres/radar'), result.stdout);
    assert.equal(object(f, 'radar-change-lock'), undefined);
    assert.deepEqual(object(f, 'application').spec, ingress);
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar').toString('base64'));
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    const receipt = JSON.parse(object(f, 'radar-cutover-receipt').data.receipt);
    assert.equal(receipt.checkpoints.switch, 'rolled-back');
    assert.ok(Object.values(receipt.jobs).every(j => j.outcome === 'completed'));
  } finally { f.cleanup(); }
});
test('cutover re-checks documents before closure with the preparation budget', () => {
  // 30/10 incident: recon needs about 98 s; the post-closure 60 s Job (40 s wrapper) failed.
  const f = fixture({ jobSeconds: { recon: 98 } });
  try {
    success(f.run('prepare'));
    const before = f.state().jobCreation.length;
    success(f.run('run', ['MODE=run']));
    const recon = f.state().jobCreation.slice(before).filter(j => j.step === 'recon');
    assert.deepEqual(recon.map(j => j.closed), [false]);
    const run = JSON.parse(object(f, 'radar-cutover-receipt').data.receipt).run;
    assert.equal(object(f, `cutover-${run}-recon`).spec.activeDeadlineSeconds, 840);
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar_next').toString('base64'));
  } finally { f.cleanup(); }
});
test('a recon failure refuses the cutover before any closure', () => {
  const f = fixture({ jobSeconds: { recon: 98 } });
  try {
    success(f.run('prepare'));
    const ingress = clone(object(f, 'application').spec);
    const state = f.state(); state.jobSeconds.recon = 900; save(f, state);
    const result = f.run('run', ['MODE=run']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('-recon'), result.stderr);
    assert.deepEqual(object(f, 'application').spec, ingress);
    assert.equal(object(f, 'radar-change-lock'), undefined);
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar').toString('base64'));
  } finally { f.cleanup(); }
});
// Closed cutover interrupted before the database switch, as on 30/10 (switch never started).
function closedBeforeSwitch(f) {
  success(f.run('prepare'));
  const ingress = clone(object(f, 'application').spec);
  const state = f.state(); state.crash = { step: 'switch', edge: 'before-started' }; save(f, state);
  assert.notEqual(f.run('run', ['MODE=run']).status, 0);
  assert.ok(JSON.stringify(object(f, 'application').spec).includes('base-maintenance-'));
  return { ingress, record: JSON.parse(object(f, 'radar-change-lock').data.record) };
}
function failedJob(f, record, phase) {
  const state = f.state();
  const name = `cutover-${record.run}-refused`, uid = 'uid-refused-job';
  state.objects.push({ kind: 'Job', metadata: { name, uid, labels: { 'sentropic.io/bascule': record.run } },
    status: { conditions: [{ type: 'Failed', status: 'True' }], failed: 1 } });
  state.objects.push({ kind: 'Pod', metadata: { name: `${name}-pod`, uid: 'uid-refused-pod', labels: { 'job-name': name },
    ownerReferences: [{ kind: 'Job', controller: true, uid }] }, status: { phase } });
  const lock = state.objects.find(o => o.metadata.name === 'radar-change-lock');
  const r = JSON.parse(lock.data.record);
  r.jobs.refused = { name, uid, hash: 'h', outcome: 'failed' };
  lock.data.record = JSON.stringify(r);
  save(f, state);
}
test('rollback reopens when the record holds a terminated Failed Job', () => {
  const f = fixture();
  try {
    const { ingress, record } = closedBeforeSwitch(f);
    failedJob(f, record, 'Failed');
    success(f.run('rollback', [`RUN=${record.run}`, 'MODE=run']));
    assert.deepEqual(object(f, 'application').spec, ingress);
    assert.equal(object(f, 'radar-change-lock'), undefined);
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    assert.equal(JSON.parse(object(f, 'radar-cutover-receipt').data.receipt).checkpoints.switch, 'rolled-back');
  } finally { f.cleanup(); }
});
test('rollback stays closed while a Failed Job still has a live consumer', () => {
  const f = fixture();
  try {
    const { record } = closedBeforeSwitch(f);
    failedJob(f, record, 'Running');
    const result = f.run('rollback', [`RUN=${record.run}`, 'MODE=run']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('live consumers'), result.stderr);
    assert.ok(JSON.stringify(object(f, 'application').spec).includes('base-maintenance-'));
    assert.ok(object(f, 'radar-change-lock'));
  } finally { f.cleanup(); }
});
test('rollback before the database switch keeps the live database without a rejected request', () => {
  const f = fixture();
  try {
    const { ingress, record } = closedBeforeSwitch(f);
    const result = f.run('rollback', [`RUN=${record.run}`, 'MODE=run']);
    success(result);
    assert.equal(result.stderr.includes('The request is invalid'), false, result.stderr);
    assert.equal(object(f, 'radar-db-credentials').data.POSTGRES_DB, Buffer.from('radar').toString('base64'));
    assert.deepEqual(object(f, 'application').spec, ingress);
  } finally { f.cleanup(); }
});
const job = (f, step) => f.state().jobCreation.filter(j => j.step === step).length;
test('prepare clones a staged template matching the pin, and stages first on a mismatch', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    let stamp = object(f, 'radar-prepared-db').data;
    assert.equal(stamp.restorePath, 'stage+clone');
    assert.deepEqual([job(f, 'restore'), job(f, 'docs'), job(f, 'recon'), job(f, 'clone')], [1, 1, 0, 1], 'no duplicate recon after docs');
    const template = object(f, 'radar-template-db').data;
    assert.deepEqual([template.status, template.date, template.pgSha256, template.sizeBytes], ['ready', '2026-10-29', 'e'.repeat(64), '281512198']);
    // Same pin: clone path, the only document work is one reconciliation.
    success(f.run('prepare'));
    stamp = object(f, 'radar-prepared-db').data;
    assert.equal(stamp.restorePath, 'clone');
    assert.ok(Number(stamp.restoreSeconds) >= 0 && Number(stamp.restoreSeconds) <= 300, stamp.restoreSeconds);
    assert.deepEqual([job(f, 'restore'), job(f, 'docs'), job(f, 'recon'), job(f, 'clone')], [1, 1, 1, 2]);
    // A newer backup than the staged template: stage first, reported as such.
    const state = f.state(); state.pinOverride = { date: '2026-10-30', pgSha256: 'f'.repeat(64) }; save(f, state);
    success(f.run('prepare'));
    assert.equal(object(f, 'radar-prepared-db').data.restorePath, 'stage+clone');
    assert.equal(object(f, 'radar-template-db').data.date, '2026-10-30');
    assert.deepEqual([job(f, 'restore'), job(f, 'clone')], [2, 3]);
  } finally { f.cleanup(); }
});
test('daily staging builds the template under the lock and refuses while a preparation runs or the volume is short', () => {
  const f = fixture();
  try {
    success(f.run('stage', ['RELEASE=deployed']));
    const template = object(f, 'radar-template-db').data;
    assert.equal(template.status, 'ready');
    assert.deepEqual(f.state().jobCreation.map(j => j.step).filter(s => s !== 'database'),
      ['resolve', 'tplreset', 'restore', 'docs', 'tplseal']);
    const restore = f.state().objects.find(o => o.kind === 'Job' && o.metadata.name.endsWith('-restore'));
    assert.equal(restore.spec.template.spec.containers[0].env.find(e => e.name === 'PGDATABASE').value, 'radar_tpl');
    assert.equal(object(f, 'radar-change-lock'), undefined);
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    const state = f.state();
    state.objects.push({ kind: 'ConfigMap', metadata: { name: 'radar-prepared-db', uid: 'p', resourceVersion: '1' }, data: { status: 'preparing' } });
    save(f, state);
    assert.notEqual(f.run('stage', ['RELEASE=deployed']).status, 0);
    const short = f.state(); short.objects = short.objects.filter(o => o.metadata.name !== 'radar-prepared-db');
    short.pvcMeasure = '3000000000 5000000000 21474836480\n'; save(f, short);
    const refused = f.run('stage', ['RELEASE=deployed']);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /volume_insufficient/);
    assert.equal(object(f, 'radar-template-db').data.status, 'ready', 'a refused staging never touches the ready template');
  } finally { f.cleanup(); }
});
test('prepare starts a Ready prepared slot on the target database without touching canonical routing', () => {
  const f = fixture();
  try {
    const state = f.state(); state.objects.find(o => o.kind === 'Deployment' && o.metadata.name === 'radar-api').spec.replicas = 2; save(f, state);
    success(f.run('prepare'));
    const api = object(f, 'radar-api-prepared'), mcp = object(f, 'radar-immo-mcp-prepared'), ui = object(f, 'radar-ui-prepared');
    assert.equal(api.spec.replicas, 2, 'replicas equal the current canonical count');
    for (const d of [api, mcp, ui]) {
      assert.equal(d.spec.selector.matchLabels['sentropic.io/slot'], 'prepared');
      assert.ok(d.spec.template.metadata.labels['app.kubernetes.io/component'], 'component label kept for NetworkPolicies');
      assert.equal(d.spec.template.spec.terminationGracePeriodSeconds, 30);
    }
    const env = d => d.spec.template.spec.containers[0].env;
    assert.deepEqual(env(api).filter(e => e.name === 'POSTGRES_DB'), [{ name: 'POSTGRES_DB', value: 'radar_next' }]);
    assert.ok(env(mcp).some(e => e.name === 'RADAR_API_BASE_URL' && e.value === 'http://radar-api-prepared:3000'));
    assert.equal(api.spec.template.spec.containers[0].image, f.release.apiImage);
    assert.equal(ui.spec.template.spec.containers[0].image, f.release.uiImage);
    const nginx = object(f, 'radar-ui-nginx-prepared').data['default.conf'];
    assert.ok(nginx.includes('http://radar-api-prepared:3000/health') && !nginx.includes('http://radar-api:3000'));
    for (const name of ['radar-api', 'radar-immo-mcp', 'radar-ui']) {
      assert.equal(f.state().objects.find(o => o.kind === 'Service' && o.metadata.name === name).spec.selector['sentropic.io/slot'], 'main');
      assert.equal(f.state().objects.find(o => o.kind === 'Service' && o.metadata.name === `${name}-prepared`).spec.selector['sentropic.io/slot'], 'prepared');
    }
    assert.equal(object(f, 'radar-prepared-db').data.status, 'ready');
    // A new preparation removes the previous slot before replacing its database.
    success(f.run('prepare'));
    assert.ok(f.state().deletions.some(d => d.kind === 'Deployment' && d.name === 'radar-api-prepared'));
  } finally { f.cleanup(); }
});
test('prepare refuses quota_insufficient before creating any prepared object', () => {
  const f = fixture({ quota: { hard: { 'limits.cpu': '3', 'limits.memory': '6Gi' }, used: { 'limits.cpu': '2500m', 'limits.memory': '1920Mi' } } });
  try {
    const result = f.run('prepare');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /quota_insufficient: preprod-cap\/limits.cpu/);
    assert.equal(f.state().objects.some(o => o.metadata.name.endsWith('-prepared') && o.kind !== 'ConfigMap'), false);
    assert.equal(object(f, 'radar-prepared-db').data.status, 'failed');
  } finally { f.cleanup(); }
});
