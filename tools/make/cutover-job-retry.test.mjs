import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './cutover-fixture.mjs';

function retry(step, state, { unreadable = false, live = false, changedUid = false, unreadablePods = false, orphaned = false } = {}) {
  const f = fixture();
  const run = '11111111-1111-4111-8111-111111111111', name = `cutover-${run}-${step}`;
  const record = { run, jobs: { [step]: { name, uid: 'original', hash: 'hash', outcome: 'started' } }, checkpoints: {} };
  writeFileSync(join(f.dir, 'record.json'), JSON.stringify(record));
  const s = f.state();
  if (unreadable) s.getFail = `job/${name}`;
  if (unreadablePods) s.getFail = 'pods/-l';
  if (state !== 'missing') s.objects.push({ kind: 'Job', metadata: { name, uid: changedUid ? 'replacement' : 'original',
    labels: { 'sentropic.io/bascule': run }, annotations: { 'cutover-spec-sha256': 'hash' } },
    status: { conditions: [{ type: state, status: 'True' }] } });
  if (state !== 'missing' || live) s.objects.push({ kind: 'Pod', metadata: { name: `${name}-pod`, labels: { 'job-name': name },
    ownerReferences: orphaned ? [] : [{ kind: 'Job', controller: true, uid: 'original' }] }, status: { phase: live ? 'Running' : 'Succeeded',
    containerStatuses: [{ state: { terminated: { message: '{"ok":true}' } } }] } });
  writeFileSync(join(f.dir, 'state.json'), JSON.stringify(s));
  const result = spawnSync('bash', ['-euc', `
    set -o pipefail
    fail() { echo "$*" >&2; exit 1; }
    unknown_state() { fail "$*"; }
    record_save() { :; }; checkpoint() { :; }
    source tools/make/cutover-jobs.sh
    k=(kubectl); WORK="$1"; RUN="$2"; NS=synthetic; RECOVERING=1
    render_job() {
      jq -n --arg name "$2" --arg run "$RUN" '{kind:"Job",metadata:{name:$name,labels:{"sentropic.io/bascule":$run}},
        spec:{activeDeadlineSeconds:30,template:{spec:{containers:[{env:[]}]}}}}' > "$WORK/job.json"
    }
    run_job "$3" 30 45
  `, 'test', f.dir, run, step], { env: f.env, encoding: 'utf8' });
  return { f, result, record: () => JSON.parse(readFileSync(join(f.dir, 'record.json'), 'utf8')) };
}
for (const step of ['identity', 'database', 'destination', 'verify', 'recon', 'probe', 'probeverify', 'volume0', 'writestats0', 'freeze', 'unfreeze', 'unfreezeprev']) {
  for (const state of ['Failed', 'missing']) {
    test(`recovery retries a ${state} ${step} helper with a fresh name after its consumers stopped`, () => {
      const { f, result, record } = retry(step, state);
      try {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const saved = record();
        assert.equal(saved.jobHistory.length, 1);
        assert.notEqual(saved.jobs[step].name, saved.jobHistory[0].name);
        assert.equal(saved.jobs[step].outcome, 'completed');
        assert.equal(f.state().jobCreation.length, 1);
      } finally { f.cleanup(); }
    });
  }
}
for (const [step, state, options] of [
  ['identity', 'Failed', { unreadable: true }], ['identity', 'Failed', { changedUid: true }],
  ['identity', 'Failed', { live: true }], ['identity', 'missing', { live: true }], ['identity', 'Failed', { unreadablePods: true }], ['restore', 'missing', {}],
  ['identity', 'missing', { live: true, orphaned: true }],
]) {
  test(`recovery refuses to retry ${step}/${state} with unknown or live execution: ${JSON.stringify(options)}`, () => {
    const { f, result } = retry(step, state, options);
    try {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /unknown|UID.*(?:changed|conflict)|consumers|indeterminate/);
      assert.deepEqual(f.state().jobCreation || [], []);
    } finally { f.cleanup(); }
  });
}
test('recovery observes a completed identity Job without starting another', () => {
  const { f, result } = retry('identity', 'Complete');
  try { assert.equal(result.status, 0, result.stdout + result.stderr); assert.deepEqual(f.state().jobCreation || [], []); }
  finally { f.cleanup(); }
});
