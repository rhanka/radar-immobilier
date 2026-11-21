import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';
function concurrent(f) {
  return new Promise(resolve => {
    const child = spawn('make', ['-s', '-f', 'deploy/cutover/operator.mk', 'lock', 'ENV=preprod'], { env: f.env });
    child.stdout.resume(); child.stderr.resume(); child.on('exit', code => resolve(code));
  });
}
test('atomic creation excludes concurrent writers and same-release invocation', async () => {
  const f = fixture();
  try {
    const results = await Promise.all([concurrent(f), concurrent(f)]);
    assert.deepEqual(results.sort(), [0, 2]);
    assert.notEqual(f.run().status, 0);
    const record = JSON.parse(f.state().objects.find(o => o.metadata.name === 'radar-change-lock').data.record);
    assert.equal(record.kind, 'writer');
    assert.equal(f.run('resume', [`RUN=${record.run}`]).status, 0);
  } finally { f.cleanup(); }
});
test('resume refuses active local executor, foreign host and wrong RUN', () => {
  const f = fixture();
  try {
    assert.equal(f.run('lock').status, 0);
    const state = f.state();
    const cm = state.objects.find(o => o.metadata.name === 'radar-change-lock');
    const record = JSON.parse(cm.data.record);
    record.executor.host = 'unknown-host'; cm.data.record = JSON.stringify(record);
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
    assert.notEqual(f.run('resume', [`RUN=${record.run}`]).status, 0);
    assert.notEqual(f.run('resume', ['RUN=00000000-0000-0000-0000-000000000000']).status, 0);
  } finally { f.cleanup(); }
});
test('writer release-lock retains lock while a Job or Pod lives and releases once a failed Job terminates', () => {
  const f = fixture();
  try {
    const githubEnv = join(f.dir, 'github-env');
    writeFileSync(githubEnv, '');
    const ghEnv = {
      ...f.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'rhanka/radar-immobilier',
      GITHUB_RUN_ID: '44860026183',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'reannotate',
      GITHUB_ENV: githubEnv,
    };
    const runGh = (action, extra = []) => spawnSync(
      'make',
      ['-s', '-f', 'deploy/cutover/operator.mk', action, ...extra, 'ENV=preprod'],
      { env: ghEnv, encoding: 'utf8', timeout: 60000 },
    );
    const lockRes = runGh('lock');
    assert.equal(lockRes.status, 0, lockRes.stderr);
    const match = readFileSync(githubEnv, 'utf8').match(/^CUTOVER_LOCK_RUN=([0-9a-f-]+)$/m);
    assert.ok(match, 'lock exports CUTOVER_LOCK_RUN to GITHUB_ENV');
    const runId = match[1];

    // 1. Live unscheduled Job + Running Pod: release-lock MUST retain the lock.
    const state = f.state();
    const jobUid = 'uid-radar-reannotate-prod-20261121031413';
    state.objects.push(
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'radar-reannotate-prod-20261121031413', uid: jobUid, resourceVersion: '1' },
        spec: { backoffLimit: 0 },
        status: { active: 1 },
      },
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: 'radar-reannotate-prod-20261121031413-6zm2k',
          uid: 'uid-pod-6zm2k',
          resourceVersion: '1',
          ownerReferences: [{ kind: 'Job', controller: true, uid: jobUid }],
        },
        status: { phase: 'Running' },
      },
    );
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
    const stillRunning = runGh('release-lock', [`RUN=${runId}`]);
    assert.notEqual(stillRunning.status, 0);
    assert.match(stillRunning.stderr, /Writer Jobs have not terminated/);
    assert.ok(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'), 'lock retained while Job runs');

    // 2. Job marked Failed=True but Pod still Running: release-lock MUST still retain the lock.
    const stateJobFailed = f.state();
    stateJobFailed.objects.find(o => o.metadata.uid === jobUid).status = {
      conditions: [{ type: 'Failed', status: 'True' }],
    };
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(stateJobFailed));
    const podRunning = runGh('release-lock', [`RUN=${runId}`]);
    assert.notEqual(podRunning.status, 0);
    assert.match(podRunning.stderr, /Writer Job Pods have not terminated/);
    assert.ok(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'), 'lock retained while Pod runs');

    // 3. Job Failed=True AND Pod Failed (e.g. SQL 57014): release-lock deletes radar-change-lock.
    const stateTerminated = f.state();
    stateTerminated.objects.find(o => o.metadata.uid === 'uid-pod-6zm2k').status = { phase: 'Failed' };
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(stateTerminated));
    const released = runGh('release-lock', [`RUN=${runId}`]);
    assert.equal(released.status, 0, released.stderr);
    assert.equal(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'), false, 'lock deleted once Job and Pod terminated');

    // 4. Subsequent lock (retry or promotion) succeeds immediately.
    const nextLock = runGh('lock');
    assert.equal(nextLock.status, 0, nextLock.stderr);
  } finally { f.cleanup(); }
});

test('writer release-lock ignores Pods owned by CronJob-managed Jobs while still blocking unscheduled or orphan Job Pods', () => {
  const f = fixture();
  try {
    const githubEnv = join(f.dir, 'github-env');
    writeFileSync(githubEnv, '');
    const ghEnv = {
      ...f.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'rhanka/radar-immobilier',
      GITHUB_RUN_ID: '44860099999',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'reannotate',
      GITHUB_ENV: githubEnv,
    };
    const runGh = (action, extra = []) => spawnSync(
      'make',
      ['-s', '-f', 'deploy/cutover/operator.mk', action, ...extra, 'ENV=preprod'],
      { env: ghEnv, encoding: 'utf8', timeout: 60000 },
    );
    const lockRes = runGh('lock');
    assert.equal(lockRes.status, 0, lockRes.stderr);
    const runId = readFileSync(githubEnv, 'utf8').match(/^CUTOVER_LOCK_RUN=([0-9a-f-]+)$/m)[1];

    // Scheduled CronJob Job + Running Pod started AFTER lock acquisition (not in originalJobs),
    // alongside a failed writer Job whose Pod is still Running.
    const cronJobUid = 'uid-radar-refresh-pv-29920260';
    const writerJobUid = 'uid-radar-reannotate-prod-20261121040000';
    const state = f.state();
    state.objects.push(
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: 'radar-refresh-pv-29920260',
          uid: cronJobUid,
          resourceVersion: '1',
          ownerReferences: [{ kind: 'CronJob', controller: true, uid: 'uid-radar-refresh-pv' }],
        },
        status: { active: 1 },
      },
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: 'radar-refresh-pv-29920260-k9m2p',
          uid: 'uid-pod-refresh-k9m2p',
          resourceVersion: '1',
          ownerReferences: [{ kind: 'Job', controller: true, uid: cronJobUid }],
        },
        status: { phase: 'Running' },
      },
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'radar-reannotate-prod-20261121040000', uid: writerJobUid, resourceVersion: '1' },
        status: { conditions: [{ type: 'Failed', status: 'True' }] },
      },
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: 'radar-reannotate-prod-20261121040000-abcde',
          uid: 'uid-pod-writer-abcde',
          resourceVersion: '1',
          ownerReferences: [{ kind: 'Job', controller: true, uid: writerJobUid }],
        },
        status: { phase: 'Running' },
      },
    );
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));

    // 1. Writer Pod still Running -> lock retained even though the CronJob Pod is ignored.
    const blockedByWriterPod = runGh('release-lock', [`RUN=${runId}`]);
    assert.notEqual(blockedByWriterPod.status, 0);
    assert.match(blockedByWriterPod.stderr, /Writer Job Pods have not terminated/);
    assert.ok(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'));

    // 2. Writer Pod terminates, but an orphan Running Pod (Job deleted) exists -> lock still retained.
    const stateOrphan = f.state();
    stateOrphan.objects.find(o => o.metadata.uid === 'uid-pod-writer-abcde').status = { phase: 'Failed' };
    stateOrphan.objects.push({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: 'deleted-job-orphan-pod',
        uid: 'uid-pod-orphan',
        resourceVersion: '1',
        ownerReferences: [{ kind: 'Job', controller: true, uid: 'uid-deleted-job' }],
      },
      status: { phase: 'Running' },
    });
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(stateOrphan));
    const blockedByOrphan = runGh('release-lock', [`RUN=${runId}`]);
    assert.notEqual(blockedByOrphan.status, 0);
    assert.match(blockedByOrphan.stderr, /Writer Job Pods have not terminated/);

    // 3. Orphan Pod removed; CronJob Job + Running Pod (radar-refresh-pv-*) still active -> lock releases cleanly.
    const stateCronOnly = f.state();
    stateCronOnly.objects = stateCronOnly.objects.filter(o => o.metadata.uid !== 'uid-pod-orphan');
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(stateCronOnly));
    const released = runGh('release-lock', [`RUN=${runId}`]);
    assert.equal(released.status, 0, released.stderr);
    assert.equal(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'), false,
      'lock released while scheduled CronJob Job and Pod continue running');
  } finally { f.cleanup(); }
});
