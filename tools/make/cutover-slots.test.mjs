import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';
const NAMES = ['radar-api', 'radar-immo-mcp', 'radar-ui'];
const get = (f, kind, name) => f.state().objects.find(o => o.kind === kind && o.metadata.name === name);
test('slot adoption orphans, recreates on slot=main, moves the Service selector, then deletes the orphaned ReplicaSet', () => {
  const f = fixture({ unadopted: true });
  try {
    const result = f.run('slots-adopt', ['DRAIN=0']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const name of NAMES) {
      const deployment = get(f, 'Deployment', name);
      assert.equal(deployment.spec.selector.matchLabels['sentropic.io/slot'], 'main');
      assert.equal(deployment.spec.template.metadata.labels['sentropic.io/slot'], 'main');
      assert.equal(get(f, 'Service', name).spec.selector['sentropic.io/slot'], 'main');
      assert.equal(get(f, 'ReplicaSet', `${name}-rs`), undefined, 'orphaned ReplicaSet deleted');
      assert.ok(f.state().objects.some(o => o.kind === 'Pod' && o.metadata.labels?.['sentropic.io/slot'] === 'main'
        && o.metadata.labels['app.kubernetes.io/component'] === deployment.spec.template.metadata.labels['app.kubernetes.io/component']));
      // Order: orphaning, then the Service selector, then the orphaned ReplicaSet deletion.
      const calls = f.calls().map(c => c.join(' '));
      const orphaned = calls.findIndex(c => c.includes(`/deployments/${name}`) && c.includes('delete'));
      const selected = calls.findIndex(c => c.includes(`patch service ${name}`));
      const removed = calls.findIndex(c => c.includes(`/replicasets/${name}-rs`));
      const followed = calls.findIndex((c, i) => i > selected && c.includes('job-name=cutover-') && /-logsorphan[0-9]/.test(c));
      assert.ok(followed > selected && followed < removed, `${name}: orphan logs followed before the ReplicaSet deletion`);
      assert.ok(orphaned >= 0 && orphaned < selected && selected < removed, `${name}: ${orphaned} < ${selected} < ${removed}`);
    }
    assert.equal(f.state().jobCreation.filter(j => j.step.startsWith('logsorphan')).length, 3);
    assert.equal(get(f, 'ConfigMap', 'radar-change-lock'), undefined);
    const before = f.calls().length;
    assert.equal(f.run('slots-adopt', ['DRAIN=0']).status, 0, 'rerun');
    assert.equal(f.calls().slice(before).filter(c => !c.includes('auth') && !c.join(' ').includes('radar-change-lock')).some(c => c.includes('delete') || (c.includes('create') && c.includes('-f')
      && !c.join(' ').includes('lock-request.json'))), false, 'a rerun recreates and deletes nothing');
  } finally { f.cleanup(); }
});
test('slot adoption refuses a concurrently changed Service selector and keeps the orphan serving', () => {
  const f = fixture({ unadopted: true });
  try {
    const state = f.state(); state.serviceConflict = 'radar-api';
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
    assert.notEqual(f.run('slots-adopt', ['DRAIN=0']).status, 0);
    assert.ok(get(f, 'ReplicaSet', 'radar-api-rs'), 'orphaned ReplicaSet kept while routing still selects it');
    assert.equal(get(f, 'Service', 'radar-api').spec.selector['sentropic.io/slot'], undefined);
    assert.equal(get(f, 'ConfigMap', 'radar-change-lock'), undefined, 'adoption is rerunnable');
  } finally { f.cleanup(); }
});
