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
    assert.equal(object(f, 'radar-api-prepared'), undefined);
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    const restore = f.state().jobCreation.find(j => j.step === 'restore');
    assert.deepEqual([restore.closed, restore.lockHeld, restore.preparedStatus, restore.watchdogSuspended], [false, false, 'preparing', true]);
    for (const job of f.state().objects.filter(o => o.kind === 'Job' && /-(restore|ddl|data)$/.test(o.metadata.name))) {
      const env = job.spec.template.spec.containers[0].env;
      assert.equal(env.find(e => e.name === 'POSTGRES_DB').value, 'radar_next');
      if (job.metadata.name.endsWith('-restore')) {
        assert.equal(env.find(e => e.name === 'PGDATABASE').value, 'radar_next');
        assert.equal(env.find(e => e.name === 'LIVE_DB').value, 'radar');
        assert.deepEqual(job.spec.template.spec.containers[0].resources,
          { requests: { cpu: '250m', memory: '1Gi' }, limits: { cpu: '1500m', memory: '2Gi' } });
      }
      if (job.metadata.name.endsWith('-data')) {
        const evidence = JSON.parse(env.find(e => e.name === 'CUTOVER_EVIDENCE').value);
        const pods = f.state().objects.filter(o => o.kind === 'Pod' && /-(restore|ddl)-pod$/.test(o.metadata.name));
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
    assert.ok(f.state().jobCreation.some(j => j.step === 'discard'));
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
test('prepare drains owned refresh for at most ten minutes without killing it', () => {
  const f = fixture({ fastClock: true });
  try {
    const state = f.state();
    state.objects.push({ kind: 'Job', metadata: { name: 'draining-refresh', uid: 'draining-refresh-uid',
      ownerReferences: [{ kind: 'CronJob', controller: true, uid: 'uid-radar-refresh-pv' }] }, status: { active: 1 } });
    save(f, state);
    const result = f.run('prepare');
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('drain exceeded ten minutes'), result.stderr);
    assert.equal(object(f, 'radar-prepared-db').data.status, 'failed');
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    assert.equal(f.state().jobCreation.some(j => j.step === 'docs'), false);
    assert.equal(f.calls().some(c => c.includes('delete') && c.some(a => a.endsWith('/jobs/draining-refresh'))), false);
  } finally { f.cleanup(); }
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
