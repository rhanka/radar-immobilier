import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { fixture } from './cutover-fixture.mjs';
const claim = f => f.state().objects.find(o => o.kind === 'PersistentVolumeClaim');
const pvcPatches = f => f.calls().filter(c => c.includes('patch') && c.includes('pvc'));
const save = (f, state) => writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
test('volume expansion measures occupancy in SQL, patches the claim by CAS to max(10Gi, used + 2 x DB + 2GiB), never execs', () => {
  const f = fixture({ pvcSize: '5Gi' });
  try {
    const result = f.run('pvc-expand', []);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(claim(f).spec.resources.requests.storage, '12Gi');
    const patch = JSON.parse(pvcPatches(f)[0].at(pvcPatches(f)[0].indexOf('-p') + 1));
    assert.deepEqual(patch.filter(p => p.op === 'test').map(p => p.path), ['/metadata/uid', '/spec/resources/requests/storage']);
    assert.match(result.stdout, /PVC verified/);
    assert.ok(f.state().jobCreation.some(j => j.step.startsWith('volume')), 'occupancy measured by a SQL Job');
    assert.equal(f.calls().some(c => c.includes('exec')), false, 'no shell in the PostgreSQL Pod');
    assert.equal(f.run('pvc-expand', []).status, 0, 'a rerun is a no-op');
    assert.equal(pvcPatches(f).length, 1);
    assert.equal(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'), false);
  } finally { f.cleanup(); }
});
test('volume expansion refuses an undersized request and reports a pending filesystem resize; verify refuses short free space', () => {
  const f = fixture({ pvcSize: '5Gi' });
  try {
    assert.notEqual(f.run('pvc-expand', ['SIZE=8Gi']).status, 0);
    assert.equal(claim(f).spec.resources.requests.storage, '5Gi');
    const state = f.state(); state.pvcResize = 'pending'; save(f, state);
    const pending = f.run('pvc-expand', ['SIZE=12Gi']);
    assert.equal(pending.status, 0, pending.stderr);
    assert.match(pending.stdout, /FileSystemResizePending/);
    const tight = f.state(); tight.pvcResize = null; tight.volume = { volumeUsedBytes: 4000000000 }; save(f, tight);
    const verify = f.run('pvc-verify', []);
    assert.notEqual(verify.status, 0, 'the 5 Gi capacity stays below the need until the resize completes');
    assert.match(verify.stderr, /volume_insufficient/);
  } finally { f.cleanup(); }
});
test('no permanent Role grants pods/exec; one-time adoption and expansion rights live in rbac-adopt-<env>.yaml', () => {
  for (const env of ['preprod', 'prod']) {
    const main = YAML.parseAllDocuments(readFileSync(`deploy/cutover/rbac-${env}.yaml`, 'utf8')).map(d => d.toJS());
    const rules = main.find(d => d?.kind === 'Role').rules;
    assert.equal(rules.some(r => r.resources.includes('pods/exec')), false, env);
    assert.equal(rules.some(r => r.resources.includes('replicasets') && r.verbs.includes('delete')), false, env);
    assert.equal(rules.some(r => r.resources.includes('deployments') && r.verbs.includes('delete')
      && (!r.resourceNames || r.resourceNames.some(n => !n.endsWith('-prepared')))), false, env);
    assert.equal(rules.some(r => r.resources.includes('persistentvolumeclaims') && r.verbs.includes('patch')), false, env);
    const adopt = YAML.parseAllDocuments(readFileSync(`deploy/cutover/rbac-adopt-${env}.yaml`, 'utf8')).map(d => d.toJS());
    const once = adopt.find(d => d?.kind === 'Role').rules;
    assert.ok(once.some(r => r.resources.includes('replicasets') && r.verbs.includes('delete')));
    assert.equal(adopt.some(d => JSON.stringify(d).includes('pods/exec')), false);
  }
});
