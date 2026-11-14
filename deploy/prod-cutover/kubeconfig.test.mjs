import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fixture } from '../../tools/make/cutover-fixture.mjs';

test('diagnostic rejects absent, default, aliased default and multiple kubeconfigs before kubectl', () => {
  const f = fixture();
  try {
    for (const config of ['', `${f.env.HOME}/.kube/config`, `${f.env.HOME}/.kube/../.kube/config`,
      '~/.kube/config', '/private/a:/private/b']) {
      const result = spawnSync('make', ['-s', '-f', 'deploy/cutover/operator.mk', 'status', 'ENV=prod'],
        { env: { ...f.env, KUBECONFIG: config }, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /KUBECONFIG required|Default kubeconfig forbidden/);
      assert.equal(existsSync(`${f.dir}/calls`), false);
    }
    const allowed = f.run('status', [], 'prod');
    assert.equal(allowed.status, 0, allowed.stderr);
    for (const call of f.calls().filter(c => c[0] === 'kubectl')) {
      assert.ok(call.includes('--kubeconfig'));
      assert.ok(call.includes(f.env.KUBECONFIG));
    }
  } finally { f.cleanup(); }
});
