import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from '../../tools/make/cutover-fixture.mjs';

function check(change, expected, resume = false) {
  const f = fixture({ url: 'https://immo.sent-tech.ca' });
  try {
    // The authorization port is exercised by bindings.test.cjs. No real cluster or GH access.
    writeFileSync(join(f.dir, 'bin/node'), `#!/bin/sh
if [ "$1" = deploy/prod-cutover/cli.cjs ]; then exit 0; fi
exec /usr/local/bin/node "$@"
`, { mode: 0o755 });
    writeFileSync(join(f.dir, 'bin/gh'), `#!/bin/sh
cat "$CUTOVER_TEST_STATE/runs.json"
`, { mode: 0o755 });
    const state = f.state();
    const runs = [{ workflow_runs: [] }];
    change(state, runs);
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
    writeFileSync(join(f.dir, 'runs.json'), JSON.stringify(runs));
    const result = spawnSync('make', ['-s', '-f', 'deploy/prod-cutover/prod-cutover.mk', 'window-start',
      `RELEASE=${f.dir}/release.json`, `PREVIOUS_RELEASE=${f.dir}/release.json`, 'ENV=execution-prod'],
    { env: f.env, encoding: 'utf8', timeout: 30000 });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, expected);
    const lock = f.state().objects.find(o => o.metadata.name === 'radar-change-lock');
    if (lock) assert.equal(JSON.parse(lock.data.record).checkpoints?.['manual-inventory'], undefined);
    assert.deepEqual(f.state().jobCreation || [], []);
    if (resume) {
      const next = f.state();
      next.objects.find(o => o.metadata.name === 'radar-prepared-db').data.status = 'ready';
      writeFileSync(join(f.dir, 'state.json'), JSON.stringify(next));
      const retry = spawnSync('make', ['-s', '-f', 'deploy/prod-cutover/prod-cutover.mk', 'window-start',
        `RELEASE=${f.dir}/release.json`, `PREVIOUS_RELEASE=${f.dir}/release.json`,
        `RUN=${JSON.parse(lock.data.record).run}`, 'ENV=execution-prod'],
      { env: f.env, encoding: 'utf8', timeout: 30000 });
      assert.equal(retry.status, 0, retry.stdout + retry.stderr);
    }
  } finally { f.cleanup(); }
}
test('refuse tout SHA servi divergent, tronqué autrement ou digest différent', () => {
  for (const sha of ['bbbbbbb', 'a'.repeat(8), 'a'.repeat(39) + 'b', '', null])
    check(s => { s.release.apiServedSha = sha; }, /Historical release identity mismatch/);
  check(s => { s.objects.find(o => o.kind === 'Pod').status.containerStatuses[0].imageID = `ghcr.io/rhanka/radar-api@sha256:${'d'.repeat(64)}`; }, /Historical release identity mismatch/);
});
test('refuse preparing même ancien et état de préparation inconnu sous le verrou', () => {
  for (const status of ['preparing', 'unknown', null]) check(s => {
    s.objects.push({ kind: 'ConfigMap', metadata: { name: 'radar-prepared-db' },
      data: { status, preparedAt: '2000-01-01T00:00:00Z' } });
  }, /CD preparation active or indeterminate/, status === 'preparing');
});
test('refuse les runs v* actifs ou en attente, y compris sur une page suivante', () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested', null])
    check((s, pages) => { pages.push({ workflow_runs: [{ head_branch: 'v1.2.20', event: 'push', status }] }); }, /Tag build or promote-prod/);
  check((s, pages) => { pages[0].workflow_runs.push({ head_branch: 'main', event: 'workflow_dispatch', status: 'waiting' }); }, /Tag build or promote-prod/);
  check((s, pages) => { pages[0] = {}; }, /Tag build or promote-prod/);
});
test('refuse un Job CD non terminé et un verrou déjà détenu', () => {
  check(s => { s.objects.push({ kind: 'Job', metadata: { name: 'unfinished' }, status: { active: 1 } }); }, /CD Job has not terminated/);
  check(s => { s.objects.push({ kind: 'ConfigMap', metadata: { name: 'radar-change-lock' },
    data: { record: JSON.stringify({ run: 'existing' }) } }); }, /competing operation/);
});
