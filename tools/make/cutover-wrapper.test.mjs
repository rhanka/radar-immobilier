import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
test('wrapper retains bounded hashed inventory anomalies without exposing document keys', () => {
  const wrapper = readFileSync('deploy/cutover/job-wrapper.cjs', 'utf8');
  const key = 'synthetic-private-document-key';
  const anomaly = { keySha256: 'a'.repeat(64), inventorySize: 790337, versionSize: 797540 };
  for (const invalid of [false, true]) {
    const raw = { inventoryAnomalyCount: 12, inventoryAnomaliesTruncated: false,
      inventoryAnomalies: invalid ? [{ ...anomaly, keySha256: key }, { ...anomaly, versionSize: -1 }] :
        Array.from({ length: 12 }, () => ({ ...anomaly, key })) };
    const command = [process.execPath, '-e', 'console.log(' + JSON.stringify(JSON.stringify(raw)) + ')'];
    const result = spawnSync(process.execPath, ['-e', wrapper], { encoding: 'utf8', env: { ...process.env,
      CUTOVER_COMMAND: JSON.stringify(command), CUTOVER_TIMEOUT: '5' } });
    assert.equal(result.status, 0);
    const verdict = readFileSync('/dev/termination-log', 'utf8');
    assert.equal(verdict.includes(key), false);
    const clean = JSON.parse(verdict);
    assert.equal(clean.inventoryAnomalyCount, 12);
    assert.deepEqual(clean.inventoryAnomalies, invalid ? [] : Array(10).fill(anomaly));
    assert.equal(clean.inventoryAnomaliesTruncated, !invalid);
    assert.ok(Buffer.byteLength(verdict) < 4096);
  }
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
