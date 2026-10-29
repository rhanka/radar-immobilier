import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
test('wrapper suppresses arbitrary SQL/errors/notices and allowlists termination fields', () => {
  const wrapper = readFileSync('deploy/cutover/job-wrapper.cjs', 'utf8');
  const injected = 'synthetic-confidential-child-value';
  const command = [process.execPath, '-e', `console.error('${injected}');console.log(JSON.stringify({ok:true,status:'open-success',epoch:'scoped',sealedUnresolved:0,maintenanceBarrier:false,cause:'${injected}'}))`];
  const result = spawnSync(process.execPath, ['-e', wrapper], { encoding: 'utf8', env: { ...process.env,
    CUTOVER_COMMAND: JSON.stringify(command), CUTOVER_TIMEOUT: '5' } });
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  const verdict = readFileSync('/dev/termination-log', 'utf8');
  assert.equal(verdict.includes(injected), false);
  assert.deepEqual(JSON.parse(verdict), { ok: true, sealedUnresolved: 0, maintenanceBarrier: false, status: 'open-success', epoch: 'scoped' });
  rmSync('/dev/termination-log');
});
test('shell wrapper preserves failure status and suppresses command output', () => {
  const wrapper = readFileSync('deploy/cutover/shell-wrapper.sh', 'utf8');
  for (const status of [0, 17]) {
    const result = spawnSync('sh', ['-c', wrapper, '--', 'sh', '-c', `echo synthetic-child-output; echo synthetic-child-error >&2; exit ${status}`], { encoding: 'utf8' });
    assert.equal(result.status, status); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(readFileSync('/dev/termination-log', 'utf8')), { ok: status === 0 });
  }
  rmSync('/dev/termination-log');
});
