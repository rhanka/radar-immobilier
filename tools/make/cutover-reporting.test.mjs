import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretValuesFromEnv, SECRET_SPECS, specsForMode, makeCiSecrets } from '../../deploy/ci/bascule-preprod/ci-secrets.mjs';
import { basculeMode, validateBackupIdInput, validateCycleId } from '../../deploy/ci/bascule-preprod/backup-utils.mjs';
test('reporting accepts explicit backup dates/cycles and removes the live-dump mode', () => {
  assert.equal(basculeMode({}), 'restore');
  assert.throws(() => basculeMode({ MODE: 'chain' }));
  assert.throws(() => specsForMode('chain'));
  assert.equal(validateBackupIdInput('2026-10-28', '2026-10-29'), '2026-10-28');
  assert.throws(() => validateBackupIdInput('2026-11-01', '2026-10-29'));
  assert.throws(() => validateCycleId('invalid\ncycle'));
});
test('named Secret synchronization refuses missing credentials without exposing values', () => {
  const synthetic = 'a'.repeat(32);
  for (const name of ['backup-reader', 'backup-restore-docs']) {
    const spec = SECRET_SPECS[name];
    assert.throws(() => secretValuesFromEnv({}, spec.keys, spec.fixed));
    const env = Object.fromEntries(Object.values(spec.keys).map(k => [k, synthetic]));
    const values = secretValuesFromEnv(env, spec.keys, spec.fixed);
    assert.deepEqual(Object.keys(values).sort(), ['BACKUP_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']);
  }
  const commands = makeCiSecrets({ log: () => {}, section: () => {}, die: () => { throw Error('refused'); },
    jobDefaults: () => ({ NAMESPACE: 'radar-immobilier-preprod' }), run: () => { throw Error('must not reach cluster'); } });
  assert.deepEqual(Object.keys(commands.commands), ['backup-secrets-fill']);
});
