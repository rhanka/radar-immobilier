import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
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
  const objects = new Map(), events = [], ends = [];
  return { objects, events, end: () => { events.push('containers exited'); for (const e of ends) e(); },
    k8s: { getPod: async name => pods[name] || null,
      // A followed stream ends only when the container exits (after SIGTERM and the drain).
      openLog: (name, container, { previous, follow }) => {
        const text = logs[`${name}/${container}${previous ? '/previous' : ''}`] ?? null;
        return { opened: Promise.resolve(true), text: follow && text !== null
          ? new Promise(resolve => ends.push(() => resolve(`${text}2026-10-30T12:06:00.000Z SIGTERM: draining\n`)))
          : Promise.resolve(text) };
      } },
    s3: { put: async (key, body) => { objects.set(key, Buffer.from(body)); },
      get: async key => (corrupt && key.endsWith('.gz') ? Buffer.from('tampered') : objects.get(key)) } };
}
test('log export opens every follow stream before any deletion and keeps the lines written until the container exits', async () => {
  const f = fakes();
  const running = exportLogs({ pods: [{ name: 'radar-api-pod1', uid: 'uid-1' }, { name: 'radar-ui-pod1', uid: 'uid-2' }],
    prefix: 'cutover-logs/preprod/run/main0', k8s: f.k8s, s3: f.s3, onOpen: () => f.events.push('streams open') });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(f.events, ['streams open'], 'readiness precedes the deletion; nothing written yet');
  f.end();
  const verdict = await running;
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.podUids, ['uid-1', 'uid-2']);
  assert.equal(verdict.logContainers, 4, 'api current + previous, migrate init container, ui');
  const manifest = JSON.parse(f.objects.get('cutover-logs/preprod/run/main0/manifest.json'));
  assert.equal(verdict.manifestSha256, sha(f.objects.get('cutover-logs/preprod/run/main0/manifest.json')));
  const api = manifest.pods[0].containers.find(c => c.container === 'api' && !c.previous);
  assert.deepEqual([api.lines, api.firstAt, api.lastAt], [3, '2026-10-30T12:00:00.000Z', '2026-10-30T12:06:00.000Z']);
  assert.match(gunzipSync(f.objects.get(api.key)).toString(), /SIGTERM: draining/);
  assert.match(gunzipSync(f.objects.get('cutover-logs/preprod/run/main0/radar-api-pod1/api.previous.log.gz')).toString(), /crashed once/);
});
test('log export refuses a missing or replaced Pod and a sha256 mismatch on re-read', async () => {
  const f = fakes();
  const missing = exportLogs({ pods: [{ name: 'radar-api-pod1', uid: 'uid-1' }, { name: 'radar-api-pod2', uid: 'uid-9' },
    { name: 'radar-ui-pod1', uid: 'uid-replaced' }], prefix: 'p', k8s: f.k8s, s3: f.s3 });
  await new Promise(resolve => setTimeout(resolve, 10)); f.end();
  const verdict = await missing;
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.podUids, ['uid-1']);
  assert.deepEqual(JSON.parse(f.objects.get('p/manifest.json')).missing, ['uid-9', 'uid-replaced']);
  const corrupt = fakes({ corrupt: true });
  const failing = exportLogs({ pods: [{ name: 'radar-ui-pod1', uid: 'uid-2' }], prefix: 'q', k8s: corrupt.k8s, s3: corrupt.s3 });
  await new Promise(resolve => setTimeout(resolve, 10)); corrupt.end();
  await assert.rejects(failing, /sha256 mismatch/);
});
for (const unavailable of ['missing Pod', 'replaced Pod', 'unopened current log', 'unopened previous log']) {
  test(`log export never authorizes deletion with ${unavailable} while another stream follows a live Pod`, async () => {
    const f = fakes();
    const getPod = f.k8s.getPod, openLog = f.k8s.openLog;
    f.k8s.getPod = name => name === 'radar-api-pod1' && unavailable.includes('Pod')
      ? Promise.resolve(unavailable === 'missing Pod' ? null : { metadata: { uid: 'replacement' } }) : getPod(name);
    f.k8s.openLog = (name, container, options) => name === 'radar-api-pod1' && unavailable.includes('log')
      && options.previous === (unavailable === 'unopened previous log')
      ? { opened: Promise.resolve(false), text: Promise.resolve(null) } : openLog(name, container, options);
    let ready = false;
    const exporting = exportLogs({ pods: [{ name: 'radar-api-pod1', uid: 'uid-1' }, { name: 'radar-ui-pod1', uid: 'uid-2' }],
      prefix: 'p', k8s: f.k8s, s3: f.s3, onOpen: () => { ready = true; } });
    // Observe rejection immediately: a refused stream must never become an unhandled rejection.
    const outcome = exporting.catch(() => null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false, 'a live Pod without its export must keep deletion blocked');
    f.end(); await outcome;
  });
}
test('the Kubernetes log adapter reports HTTP errors before readiness and rejects unknown Pod reads', async () => {
  const source = readFileSync(new URL('../../deploy/cutover/logs-export.cjs', import.meta.url), 'utf8');
  for (const statusCode of [400, 404, 500]) {
    const context = { module: { exports: {} }, require: name => name === 'node:fs' ? { readFileSync: () => 'synthetic' }
      : name === 'node:https' ? { get: (_options, onResponse) => {
        queueMicrotask(() => { const response = new EventEmitter(); response.statusCode = statusCode;
          onResponse(response); response.emit('end'); });
        return new EventEmitter();
      } } : require(name) };
    runInNewContext(`${source}\nmodule.exports.adapter = inClusterK8s;`, context);
    const adapter = context.module.exports.adapter();
    const stream = adapter.openLog('pod', 'api', { previous: false, follow: true });
    const text = stream.text.catch(() => null);
    assert.equal(await stream.opened, false, `HTTP ${statusCode} is not an open log stream`);
    await text;
    const previous = adapter.openLog('pod', 'api', { previous: true, follow: false });
    const previousText = previous.text.catch(() => null);
    assert.equal(await previous.opened, statusCode !== 500, 'only an absent previous instance is optional');
    await previousText;
    if (statusCode === 500) await assert.rejects(adapter.getPod('pod'), /500/);
    else if (statusCode === 404) assert.equal(await adapter.getPod('pod'), null);
    else await assert.rejects(adapter.getPod('pod'), /400/);
  }
});
