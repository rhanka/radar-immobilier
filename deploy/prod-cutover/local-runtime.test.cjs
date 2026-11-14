/* global require, process, AbortSignal */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout } = require('node:timers/promises');
test('an interrupted copy client stops Docker before removing its named container', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-client-test-'));
  let child;
  try {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin/docker'), `#!/bin/bash
set -eu
if [[ $1 == run ]]; then
 shift; while [[ $1 != --name ]]; do shift; done
 printf '%s' "$2" >"$CLIENT_TEST_DIR/name"
 trap 'exit 143' TERM
 while :; do sleep 0.1; done
elif [[ $1 == rm ]]; then
 printf '%s' "$3" >"$CLIENT_TEST_DIR/removed"
else exit 9; fi
`, { mode: 0o700 });
    const env = { ...process.env, HOME: dir, CLIENT_TEST_DIR: dir,
      PATH: `${dir}/bin:${process.env.PATH}`, PGHOST: '127.0.0.1', PGPORT: '25433',
      PGUSER: 'radar', PGDATABASE: 'radar_cutover_owner_20261113' };
    assert.equal(spawnSync('bash', ['deploy/prod-cutover/local-runtime.sh'], { env }).status, 0);
    child = spawn(path.join(dir, '.local/share/radar-prod-copy/bin/psql'), [], { env, stdio: 'ignore' });
    for (let i = 0; i < 40 && !fs.existsSync(path.join(dir, 'name')); i++) await setTimeout(50);
    assert.ok(fs.existsSync(path.join(dir, 'name')), 'Docker client started');
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) });
    child.kill('SIGTERM');
    const [code] = await exited;
    assert.equal(code, 143);
    assert.equal(fs.readFileSync(path.join(dir, 'removed'), 'utf8'), fs.readFileSync(path.join(dir, 'name'), 'utf8'));
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
