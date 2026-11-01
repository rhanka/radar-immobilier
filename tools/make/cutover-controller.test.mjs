import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './cutover-fixture.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const lock = f => f.state().objects.find(o => o.metadata.name === 'radar-change-lock');
const record = f => JSON.parse(lock(f).data.record);
function success(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
test('one command restores all services/routes/schedule states with fixed bounded Jobs', () => {
  const inventoryAnomalies = [{ keySha256: 'a'.repeat(64), inventorySize: 790337, versionSize: 797540 }];
  const f = fixture({ transient: 1, inventoryAnomalies });
  try {
    const original = f.state().objects.find(o => o.kind === 'Ingress').spec;
    success(f.run()); assert.equal(lock(f), undefined);
    const objects = f.state().objects;
    const receipt = JSON.parse(objects.find(o => o.metadata.name === 'radar-cutover-receipt').data.receipt);
    for (const step of ['docs', 'recon']) {
      assert.equal(receipt.jobs[step].verdict.inventoryAnomalyCount, 1);
      assert.deepEqual(receipt.jobs[step].verdict.inventoryAnomalies, inventoryAnomalies);
    }
    const creation = f.state().jobCreation;
    assert.equal(creation.find(j => j.step === 'docs').closed, false);
    assert.equal(creation.find(j => j.step === 'restore').closed, true);
    assert.ok(creation.filter(j => j.closed).every(j => j.watchdogSuspended === true));
    assert.ok(creation.findIndex(j => j.step === 'backup') < creation.findIndex(j => j.step === 'ddl'));
    assert.deepEqual(objects.find(o => o.kind === 'Ingress').spec, original);
    assert.equal(objects.find(o => o.metadata.name === 'originally-suspended').spec.suspend, true);
    assert.equal(objects.find(o => o.metadata.name === 'radar-refresh-pv').spec.suspend, false);
    assert.equal(objects.find(o => o.metadata.name === 'radar-refresh-pending-watchdog').spec.suspend, false);
    assert.equal(objects.find(o => o.metadata.name === 'radar-immo-mcp').spec.template.spec.containers[0].image, f.release.apiImage);
    for (const job of objects.filter(o => o.kind === 'Job')) {
      assert.equal(job.spec.backoffLimit, 0); assert.equal(job.spec.ttlSecondsAfterFinished, undefined);
      assert.equal(job.spec.template.metadata.labels['sentropic.io/bascule'], JSON.parse(objects.find(o => o.metadata.name === 'radar-cutover-receipt').data.receipt).run);
    }
    const jobs = f.calls().filter(c => c[0] === 'kubectl' && c.includes('create') && !c.includes('--dry-run=client'));
    assert.ok(jobs.length >= 8);
  } finally { f.cleanup(); }
});
// A failed atomic restore reopens on the intact database: cutover-restore-reopen.test.mjs.
for (const change of [{ badSha: true }, { anonymous200: true }, { publicFailure: true }, { missingMcp: true }, { failJob: 'data' }]) {
  test(`failure remains closed with original recovery record: ${JSON.stringify(change)}`, () => {
    const f = fixture(change);
    try {
      assert.notEqual(f.run().status, 0);
      assert.ok(lock(f));
      assert.equal(record(f).executor.state, 'stopped');
      assert.ok(JSON.stringify(f.state().objects.find(o => o.kind === 'Ingress').spec).includes('base-maintenance-'));
      assert.equal(f.state().objects.find(o => o.metadata.name === 'radar-refresh-pv').spec.suspend, true);
      assert.equal(f.state().objects.find(o => o.metadata.name === 'radar-refresh-pending-watchdog').spec.suspend, true);
      assert.notEqual(f.run().status, 0, 'identical release must not adopt lock');
    } finally { f.cleanup(); }
  });
}
test('lost controller after successful restore reconciles Job UID and never restores twice', () => {
  const f = fixture({ crashAfterRestore: true });
  try {
    assert.notEqual(f.run().status, 0); const run = record(f).run;
    success(f.run('resume', [`RUN=${run}`]));
    assert.equal(f.state().objects.filter(o => o.kind === 'Job' && o.metadata.name.endsWith('-restore')).length, 1);
  } finally { f.cleanup(); }
});
test('wrong cluster refuses without any mutations', () => {
  const f = fixture({ server: 'https://wrong.invalid' });
  try { assert.notEqual(f.run().status, 0); assert.equal(f.calls().some(c => c.includes('create')), false); }
  finally { f.cleanup(); }
});
test('daily restoration pins deployed digests and skips the 6H hook', () => {
  const f = fixture();
  try {
    success(f.run('run', ['RELEASE=deployed', 'MODE=restore']));
    assert.ok(f.state().jobCreation.filter(j => j.closed).every(j => j.watchdogSuspended === true));
    assert.equal(f.state().objects.some(o => o.kind === 'Job' && o.metadata.name.endsWith('-data')), false);
    assert.equal(JSON.parse(f.state().objects.find(o => o.metadata.name === 'radar-cutover-receipt').data.receipt).release.dataMigration, null);
  } finally { f.cleanup(); }
});
test('production rejects daily restoration because prepared releases are image-only', () => {
  const f = fixture({ url: 'https://immo.sent-tech.ca' });
  try {
    const state = f.state();
    const ingress = state.objects.find(o => o.kind === 'Ingress');
    ingress.spec.rules[0].host = 'immo.sent-tech.ca'; ingress.spec.tls[0].hosts = ['immo.sent-tech.ca'];
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
    assert.notEqual(f.run('run', [], 'prod').status, 0);
    assert.equal(f.calls().some(c => c.includes('create')), false);
    assert.deepEqual(f.state().jobCreation || [], []);
  } finally { f.cleanup(); }
});
test('explicit resume retries a terminated data migration through protected forward resume', () => {
  const f = fixture({ failJob: 'data' });
  try {
    assert.notEqual(f.run().status, 0);
    const run = record(f).run;
    const state = f.state(); state.failJob = null;
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
    success(f.run('resume', [`RUN=${run}`]));
    assert.equal(f.state().objects.filter(o => o.kind === 'Job' && o.metadata.name.endsWith('-restore')).length, 1);
    assert.equal(f.state().objects.filter(o => o.kind === 'Job' && o.metadata.name.endsWith('-data')).length, 2);
  } finally { f.cleanup(); }
});
for (const step of ['restore', 'backup', 'ddl', 'data']) {
  for (const edge of ['before-create', 'after-create', 'before-started', 'after-started', 'before-completed', 'after-completed']) {
    test(`interruption remains recoverable without repeating restoration: ${step}/${edge}`, () => {
      const f = fixture({ crash: { step, edge } });
      try {
        assert.notEqual(f.run().status, 0);
        const run = record(f).run;
        const result = f.run('resume', [`RUN=${run}`]);
        if (edge === 'before-create' || edge.endsWith('started')) {
          // Indeterminate Job evidence: a daily restore reopens on the verified live
          // database, except after a started protected data migration.
          assert.notEqual(result.status, 0);
          if (step === 'data') assert.ok(lock(f));
          else { assert.equal(lock(f), undefined); assert.ok(result.stdout.includes('REOPENED WITHOUT RESTORE'), result.stdout + result.stderr); }
        } else success(result);
        assert.ok(f.state().objects.filter(o => o.kind === 'Job' && o.metadata.name.endsWith('-restore')).length <= 1);
      } finally { f.cleanup(); }
    });
  }
}
test('daily restoration probes and writes the recovery backup to the preprod bucket', () => {
  const f = fixture();
  try {
    success(f.run('run', ['RELEASE=deployed', 'MODE=restore']));
    const creation = f.state().jobCreation;
    const probe = creation.findIndex(j => j.step === 'probe');
    assert.ok(probe >= 0 && probe < creation.findIndex(j => j.closed));
    const jobs = f.state().objects.filter(o => o.kind === 'Job');
    for (const step of ['probe', 'backup']) {
      const spec = JSON.stringify(jobs.find(o => o.metadata.name.endsWith(`-${step}`)).spec);
      assert.ok(spec.includes('s3://sentropic-pgbackup-preprod/db-backups/cutover-preprod-'), step);
      assert.ok(!spec.includes('radar-immobilier-backup/db-backups'), step);
    }
    const receipt = JSON.parse(f.state().objects.find(o => o.metadata.name === 'radar-cutover-receipt').data.receipt);
    assert.match(receipt.recoveryReference, /^s3:\/\/sentropic-pgbackup-preprod\/db-backups\//);
  } finally { f.cleanup(); }
});
test('unwritable recovery bucket fails before closure and reopens nothing', () => {
  const f = fixture({ failJob: 'probe' });
  try {
    const original = f.state().objects.find(o => o.kind === 'Ingress').spec;
    assert.notEqual(f.run().status, 0);
    assert.equal(lock(f), undefined);
    assert.equal(f.state().jobCreation.some(j => j.closed), false);
    assert.equal(f.state().jobCreation.some(j => ['docs', 'restore', 'backup'].includes(j.step)), false);
    assert.deepEqual(f.state().objects.find(o => o.kind === 'Ingress').spec, original);
    assert.equal(f.state().objects.find(o => o.metadata.name === 'radar-refresh-pv').spec.suspend, false);
  } finally { f.cleanup(); }
});
for (const step of ['restore', 'backup']) {
  test(`explicit resume relaunches a failed ${step} Job under a new name`, () => {
    // A refused live database verification keeps the closed record for forward resume.
    const f = fixture({ failJobs: [step, 'verify'] });
    try {
      assert.notEqual(f.run().status, 0);
      const run = record(f).run;
      const state = f.state(); state.failJobs = [];
      writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
      success(f.run('resume', [`RUN=${run}`]));
      const names = f.state().objects.filter(o => o.kind === 'Job' && o.metadata.name.endsWith(`-${step}`)).map(o => o.metadata.name);
      assert.deepEqual(names.sort(), [`cutover-${run}-1-${step}`, `cutover-${run}-${step}`].sort());
    } finally { f.cleanup(); }
  });
}
