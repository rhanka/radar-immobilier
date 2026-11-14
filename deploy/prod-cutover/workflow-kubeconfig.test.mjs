import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

test('CD and recovery workflows export an explicit kubeconfig before the guarded controller', () => {
  let count = 0;
  for (const name of ['build-push-images', 'bascule-preprod', 'bascule-bundle-cd', 'bascule-refresh', 'rollback']) {
    const text = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
    assert.ok(!text.includes('$HOME/.kube/config'), name);
    const workflow = YAML.parse(text);
    for (const job of Object.values(workflow.jobs)) {
      let configured = false;
      for (const step of job.steps || []) {
        if (step.run?.includes('export KUBECONFIG=')) {
          assert.match(step.run, /export KUBECONFIG="\$RUNNER_TEMP\/radar-tenant\.kubeconfig"/);
          assert.ok(step.run.includes('"$GITHUB_ENV"'));
          assert.equal(spawnSync('bash', ['-n'], { input: step.run }).status, 0);
          configured = true; count++;
        }
        if (step.run?.includes('make -f deploy/cutover/operator.mk') || step.uses === './deploy/cutover/lock-action')
          assert.ok(configured, `${name}: controller needs explicit kubeconfig`);
      }
    }
  }
  assert.equal(count, 11);
});
