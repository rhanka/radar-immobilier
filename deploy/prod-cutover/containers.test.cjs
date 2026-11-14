/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('./runtime.cjs');
const containers = require('./containers.cjs');
const run = '11111111-1111-1111-1111-111111111111';
test('refuses resume and rollback until the labelled hook disappears', () => {
  const original = r.run;
  let live = true;
  const calls = [];
  r.run = (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === 'ps') return live ? 'hook-id\n' : '';
    if (args[0] === 'stop') live = false;
    return '';
  };
  try {
    assert.throws(() => containers.guard(run), /run_containers_still_present/);
    assert.deepEqual(calls[0], ['docker', 'ps', '-aq', '--filter', `label=${containers.LABEL}=${run}`]);
    r.env.RUN = run;
    r.env.ENV = 'test-hook';
    assert.throws(() => r.mutationGuard(), /run_containers_still_present/);
    containers.stop(run);
    r.mutationGuard();
    assert.ok(calls.some(c => c[1] === 'wait'));
    live = true;
    r.env.STOP_RUN_CONTAINERS = '1';
    containers.guard(run);
    assert.equal(live, false);
  } finally {
    r.run = original;
    delete r.env.RUN;
    delete r.env.STOP_RUN_CONTAINERS;
  }
});
test('Docker errors and failed termination keep recovery refused', () => {
  const original = r.run;
  try {
    r.run = () => { throw Error('docker_unavailable'); };
    assert.throws(() => containers.guard(run), /docker_unavailable/);
    for (const failure of ['stop', 'rm']) {
      r.run = (bin, args) => {
        if (args[0] === 'ps') return 'hook-id';
        if (args[0] === 'inspect') return 'running';
        if (args[0] === failure) throw Error('termination_failed');
        return '';
      };
      assert.throws(() => containers.stop(run), /run_container_termination_unknown/);
      assert.throws(() => containers.guard(run), /run_containers_still_present/);
    }
  } finally { r.run = original; }
});
