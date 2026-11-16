/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const r = require('./runtime.cjs');
const containers = require('./containers.cjs');
const image = 'postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5';
test('supervised client receives SQL on standard input', () => {
  const run = randomUUID();
  const input = 'SELECT current_database();\n';
  try {
    const output = r.run('bash', ['deploy/prod-cutover/run-container.sh', run,
      'run', '--rm', '-i', '--pull=never', '--network=none',
      '--label', `${containers.LABEL}=${run}`, '--entrypoint', '/bin/cat', image], { input });
    assert.equal(output, input);
  } finally { containers.stop(run); }
});
for (const signal of ['SIGTERM', 'SIGKILL']) test(`controller ${signal} during a real Docker hook`, async () => {
  const run = randomUUID();
  const args = ['deploy/prod-cutover/run-container.sh', run, 'run', '--rm', '--pull=never',
    '--network=none', '--label', `${containers.LABEL}=${run}`, '--entrypoint', '/bin/sleep', image, '30'];
  const controller = spawn(process.execPath, ['-e',
    `require('./deploy/prod-cutover/runtime.cjs').run('bash',${JSON.stringify(args)},{timeout:60000})`],
  { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = '';
  controller.stderr.on('data', data => { diagnostic += data; });
  const exited = once(controller, 'exit');
  const present = () => r.run('docker', ['ps', '-q', '--filter', `label=${containers.LABEL}=${run}`]).trim();
  try {
    for (let i = 0; i < 500 && !present(); i++) await delay(50);
    const state = r.run('docker', ['ps', '-a', '--filter', `label=${containers.LABEL}=${run}`, '--format', '{{.State}}']);
    assert.ok(present(), `hook started: controller=${controller.exitCode}, state=${state}, ${diagnostic}`);
    process.kill(-controller.pid, signal);
    await exited;
    if (signal === 'SIGKILL') {
      assert.ok(present(), 'daemon hook survives controller death');
      assert.throws(() => containers.guard(run), /run_containers_still_present/);
      // Exercise the actual rollback entry before its first SQL write.
      const destination = r.destination;
      const previous = { RUN: r.env.RUN, ENV: r.env.ENV };
      r.destination = () => {};
      r.env.RUN = run; r.env.ENV = 'test-hook-controller';
      try {
        assert.throws(() => require('./backup.cjs').rollback(), /run_containers_still_present/);
        containers.stop(run);
        assert.doesNotThrow(() => containers.guard(run));
        assert.throws(() => require('./backup.cjs').rollback(), /drain_evidence_required/);
      } finally {
        r.destination = destination;
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete r.env[key]; else r.env[key] = value;
        }
      }
    } else {
      for (let i = 0; i < 200 && present(); i++) await delay(50);
      assert.equal(present(), '', 'TERM trap stopped and waited for hook');
    }
  } finally {
    try { process.kill(-controller.pid, 'SIGKILL'); } catch { /* group already exited */ }
    containers.stop(run);
  }
});
