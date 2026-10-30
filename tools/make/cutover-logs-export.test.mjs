import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
const require = createRequire(import.meta.url);
const { exportLogs } = require('../../deploy/cutover/logs-export.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
function fakes({ corrupt = false } = {}) {
  const pods = {
    'radar-api-pod1': { metadata: { uid: 'uid-1' }, spec: { initContainers: [{ name: 'migrate' }], containers: [{ name: 'api' }] } },
    'radar-ui-pod1': { metadata: { uid: 'uid-2' }, spec: { containers: [{ name: 'ui' }] } },
  };
  const logs = {
    'radar-api-pod1/api': '2026-10-30T12:00:00.000Z started\n2026-10-30T12:05:00.000Z request\n',
    'radar-api-pod1/api/previous': '2026-10-30T11:00:00.000Z crashed once\n',
    'radar-api-pod1/migrate': '2026-10-30T11:59:00.000Z migrated\n',
    'radar-ui-pod1/ui': '2026-10-30T12:00:01.000Z nginx\n',
  };
  const objects = new Map();
  return { objects,
    k8s: { getPod: async name => pods[name] || null,
      getLog: async (name, container, previous) => logs[`${name}/${container}${previous ? '/previous' : ''}`] ?? null },
    s3: { put: async (key, body) => { objects.set(key, Buffer.from(body)); },
      get: async key => (corrupt && key.endsWith('.gz') ? Buffer.from('tampered') : objects.get(key)) } };
}
test('log export stores current and previous logs of every container with a verified manifest', async () => {
  const f = fakes();
  const verdict = await exportLogs({ pods: [{ name: 'radar-api-pod1', uid: 'uid-1' }, { name: 'radar-ui-pod1', uid: 'uid-2' }],
    prefix: 'cutover-logs/preprod/run/main0', k8s: f.k8s, s3: f.s3 });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.podUids, ['uid-1', 'uid-2']);
  assert.equal(verdict.logContainers, 4, 'api current + previous, migrate init container, ui');
  const manifest = JSON.parse(f.objects.get('cutover-logs/preprod/run/main0/manifest.json'));
  assert.equal(verdict.manifestSha256, sha(f.objects.get('cutover-logs/preprod/run/main0/manifest.json')));
  const api = manifest.pods[0].containers.find(c => c.container === 'api' && !c.previous);
  assert.deepEqual([api.lines, api.firstAt, api.lastAt], [2, '2026-10-30T12:00:00.000Z', '2026-10-30T12:05:00.000Z']);
  assert.equal(api.sha256, sha(f.objects.get(api.key)));
  assert.match(gunzipSync(f.objects.get('cutover-logs/preprod/run/main0/radar-api-pod1/api.previous.log.gz')).toString(), /crashed once/);
});
test('log export refuses a missing or replaced Pod and a sha256 mismatch on re-read', async () => {
  const f = fakes();
  const missing = await exportLogs({ pods: [{ name: 'radar-api-pod1', uid: 'uid-1' }, { name: 'radar-api-pod2', uid: 'uid-9' },
    { name: 'radar-ui-pod1', uid: 'uid-replaced' }], prefix: 'p', k8s: f.k8s, s3: f.s3 });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.podUids, ['uid-1']);
  assert.deepEqual(JSON.parse(f.objects.get('p/manifest.json')).missing, ['uid-9', 'uid-replaced']);
  const corrupt = fakes({ corrupt: true });
  await assert.rejects(exportLogs({ pods: [{ name: 'radar-ui-pod1', uid: 'uid-2' }], prefix: 'q', k8s: corrupt.k8s, s3: corrupt.s3 }), /sha256 mismatch/);
});
