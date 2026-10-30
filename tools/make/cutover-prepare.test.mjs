import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';
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
        assert.equal(job.spec.template.spec.containers[0].resources.limits.cpu, '4');
      }
    }
    const before = f.state().jobCreation.length;
    success(f.run('run', ['MODE=run']));
    assert.ok(f.state().jobCreation.slice(before).every(j => !['restore', 'ddl', 'data', 'docs', 'backup'].includes(j.step)));
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
    const original = structuredClone(f.state());
    for (const change of [{ preparedAt: '2020-01-01T00:00:00Z' }, { gitSha: 'f'.repeat(40) },
      { manifestSha256: 'f'.repeat(64) }, { pgSha256: 'f'.repeat(64) }, { status: 'preparing' }, { targetDb: 'radar' }]) {
      const state = structuredClone(original);
      Object.assign(state.objects.find(o => o.metadata.name === 'radar-prepared-db').data, change); save(f, state);
      assert.notEqual(f.run('run', ['MODE=run']).status, 0, JSON.stringify(change));
      assert.equal(JSON.stringify(object(f, 'application').spec).includes('base-maintenance-'), false);
      assert.equal(object(f, 'radar-api').spec.replicas, 1);
      assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
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
    assert.ok(steps.every(s => !['restore', 'ddl', 'data', 'docs', 'recon'].includes(s)));
    assert.equal(f.calls().some(c => c.includes('patch') && c.includes('secret')), false);
  } finally { f.cleanup(); }
});
