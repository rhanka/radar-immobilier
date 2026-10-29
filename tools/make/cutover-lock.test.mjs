import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
