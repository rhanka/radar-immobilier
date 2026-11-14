/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
test('role provisioning refuses the read-only production and rehearsal lanes', () => {
  for (const ENV of ['prod', 'rehearsal', 'test-prod-cutover']) {
    const result = spawnSync(process.execPath, ['deploy/prod-cutover/artifact-roles.cjs'], {
      encoding: 'utf8', env: { ...process.env, ENV } });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'artifact_role_provision_refused\n');
  }
});
