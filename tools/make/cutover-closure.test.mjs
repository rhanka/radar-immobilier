import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';
function update(f, transform) {
  const state = f.state(); transform(state); writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
}
test('long owned refresh is foreground-deleted by UID after bounded shared grace', () => {
  const f = fixture({ fastClock: true });
  try {
    update(f, s => {
      s.objects.push({ kind: 'Job', metadata: { name: 'long-refresh', uid: 'long-refresh-uid',
        ownerReferences: [{ kind: 'CronJob', controller: true, uid: 'uid-radar-refresh-pv' }] }, status: { active: 1 } });
      s.objects.push({ kind: 'Pod', metadata: { name: 'refresh-consumer', uid: 'refresh-pod',
        ownerReferences: [{ kind: 'Job', controller: true, uid: 'long-refresh-uid' }] }, status: { phase: 'Running' } });
    });
    const result = f.run(); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.state().objects.some(o => o.metadata.uid === 'long-refresh-uid'), false);
    assert.ok(f.calls().some(c => c.includes('delete') && c.some(a => a.endsWith('/jobs/long-refresh'))));
    const receipt = JSON.parse(f.state().objects.find(o => o.metadata.name === 'radar-cutover-receipt').data.receipt);
    assert.ok(receipt.consumers.includes('refresh-pod'));
  } finally { f.cleanup(); }
});
test('unknown active Job with zero active counter is refused and never deleted', () => {
  const f = fixture();
  try {
    update(f, s => s.objects.push({ kind: 'Job', metadata: { name: 'unrelated', uid: 'unrelated-uid' }, status: { active: 0, failed: 1 } }));
    assert.notEqual(f.run().status, 0);
    assert.ok(f.state().objects.some(o => o.metadata.uid === 'unrelated-uid'));
    assert.equal(f.calls().some(c => c.includes('delete') && c.some(a => a.endsWith('/jobs/unrelated'))), false);
    assert.equal(JSON.stringify(f.state().objects.find(o => o.kind === 'Ingress').spec).includes('base-maintenance-'), false);
  } finally { f.cleanup(); }
});
test('ACME solver routes are excluded and partial route restoration is reclosed on conflict', () => {
  const f = fixture({ ingressConflict: 'second' });
  try {
