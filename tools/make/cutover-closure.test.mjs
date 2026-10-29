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
    update(f, s => {
      const original = s.objects.find(o => o.kind === 'Ingress');
      s.objects.push({ ...structuredClone(original), metadata: { name: 'second', uid: 'second-uid', resourceVersion: '1' } });
      s.objects.push({ ...structuredClone(original), metadata: { name: 'solver', uid: 'solver-uid', resourceVersion: '1',
        labels: { 'acme.cert-manager.io/http01-solver': 'true' } } });
    });
    assert.notEqual(f.run().status, 0);
    for (const ingress of f.state().objects.filter(o => o.kind === 'Ingress')) {
      assert.equal(JSON.stringify(ingress.spec).includes('base-maintenance-'), ingress.metadata.name !== 'solver');
    }
  } finally { f.cleanup(); }
});
test('restore observation timeout stops only its recorded Job and retains the closed lock', () => {
  const f = fixture({ hangJob: 'restore' });
  f.env['BASH_FUNC_sleep%%'] = '() { if [ "$1" = 2 ]; then SECONDS=$((SECONDS+1000)); else command sleep "$@"; fi; }';
  try {
    const result = f.run(); assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Job deadline exceeded'), result.stdout + result.stderr);
    const state = f.state();
    assert.ok(state.objects.some(o => o.metadata.name === 'radar-change-lock'));
    assert.equal(state.objects.some(o => o.kind === 'Job' && o.metadata.name.endsWith('-ddl')), false);
    assert.equal(state.objects.some(o => o.kind === 'Job' && o.metadata.name.endsWith('-restore')), false);
  } finally { f.cleanup(); }
});
test('cluster API loss retains recovery information and never reports successful reopening', () => {
  const f = fixture({ apiLostAfterRestore: true });
  f.env['BASH_FUNC_sleep%%'] = '() { if [ "$1" = 2 ]; then SECONDS=$((SECONDS+1000)); else command sleep "$@"; fi; }';
  try {
    const result = f.run(); assert.notEqual(result.status, null); assert.notEqual(result.status, 0);
    assert.equal(result.stdout.includes('SUCCESS:'), false);
    assert.ok(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'));
  } finally { f.cleanup(); }
});
