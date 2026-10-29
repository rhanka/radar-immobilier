import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const sha = 'a'.repeat(40);
const manifest = { version: 1, gitSha: sha, apiImage: `ghcr.io/rhanka/radar-api@sha256:${'b'.repeat(64)}`,
  uiImage: `ghcr.io/rhanka/radar-ui@sha256:${'c'.repeat(64)}`, apiServedSha: sha, uiServedSha: sha.slice(0, 7), dataMigration: '6h' };
function valid(value) {
  return spawnSync('jq', ['-e', '-f', 'tools/make/cutover-release.jq'], { input: JSON.stringify(value) }).status === 0;
}
test('release pins both images and only the approved data hook', () => {
  assert.ok(valid(manifest));
  assert.ok(valid({ ...manifest, dataMigration: null }));
  for (const change of [{ apiImage: 'latest' }, { gitSha: 'a' }, { uiServedSha: 'stale' },
    { dataMigration: 'arbitrary' }, { extra: 'field' }]) assert.equal(valid({ ...manifest, ...change }), false);
});
test('environment and namespace overrides reject before kubectl', () => {
  for (const env of [{ ENV: 'dev' }, { ENV: 'preprod', NAMESPACE: 'other' }]) {
    const result = spawnSync('bash', ['-ec', 'fail(){ exit 42; }; source tools/make/cutover-release.sh; cutover_config'],
      { env: { PATH: process.env.PATH, ...env } });
    assert.equal(result.status, 42);
  }
});
