import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';
const claim = f => f.state().objects.find(o => o.kind === 'PersistentVolumeClaim');
const pvcPatches = f => f.calls().filter(c => c.includes('patch') && c.includes('pvc'));
test('volume expansion patches the claim by compare-and-swap to max(10Gi, 3 x DB + 2GiB) and verifies free space', () => {
  const f = fixture();
  try {
    const result = f.run('pvc-expand', []);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(claim(f).spec.resources.requests.storage, '11Gi');
    const patch = JSON.parse(pvcPatches(f)[0].at(pvcPatches(f)[0].indexOf('-p') + 1));
    assert.deepEqual(patch.filter(p => p.op === 'test').map(p => p.path), ['/metadata/uid', '/spec/resources/requests/storage']);
    assert.match(result.stdout, /PVC verified/);
    assert.equal(f.run('pvc-expand', []).status, 0, 'a rerun is a no-op');
    assert.equal(pvcPatches(f).length, 1);
  } finally { f.cleanup(); }
});
test('volume expansion refuses an undersized request and reports a pending filesystem resize', () => {
  const f = fixture();
  try {
    assert.notEqual(f.run('pvc-expand', ['SIZE=8Gi']).status, 0);
    assert.equal(claim(f).spec.resources.requests.storage, '5Gi');
    const state = f.state(); state.pvcResize = 'pending'; writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
    const pending = f.run('pvc-expand', ['SIZE=12Gi']);
    assert.equal(pending.status, 0, pending.stderr);
    assert.match(pending.stdout, /FileSystemResizePending/);
    const tight = f.state(); tight.pvcMeasure = '3000000000 7000000000 12884901888\n'; writeFileSync(join(f.dir, 'state.json'), JSON.stringify(tight));
    assert.notEqual(f.run('pvc-verify', []).status, 0, 'free space below 2 x DB + 2 GiB');
  } finally { f.cleanup(); }
});
