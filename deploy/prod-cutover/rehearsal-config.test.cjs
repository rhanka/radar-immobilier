/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compose } = require('./rehearsal-config.cjs');
test('recette : services locaux épinglés, rôles séparés et aucune origine prod', () => {
  const c = compose('/private-synthetic', { database: 'local', account: 'reader', artifact: 'writer',
    storage: 'local', session: 'local', client: 'local', cursor: 'local', workload: 'local' });
  assert.deepEqual(Object.keys(c.services).sort(), ['api', 'idp', 'mcp', 'minio', 'ui']);
  assert.doesNotMatch(JSON.stringify(c), /sent-tech\.ca|s3\.bhs|network_mode|env_file|refresh-pv/);
  for (const service of Object.values(c.services)) {
    assert.equal(service.pull_policy, 'never');
    assert.ok(service.networks['copy-only'] || service.networks.includes('copy-only'));
    for (const port of service.ports || []) assert.match(port, /^127\.0\.0\.1:/);
  }
  const env = c.services.mcp.environment;
  assert.match(env.IMMO_MCP_ACCOUNT_DATABASE_URL, /immo_mcp_account_reader:reader@postgres/);
  assert.match(env.IMMO_MCP_ARTIFACT_DATABASE_URL, /immo_mcp_artifact_writer:writer@postgres/);
  assert.equal(env.IMMO_ARTIFACTS_GIT_MODE, 'off');
  assert.equal(c.services.api.environment.ARTIFACTS_CONTROL_MODE, 'general');
  assert.equal(c.services.api.environment.CLASSIFICATION_CURSOR_KEY_ID, 'rehearsal-v1');
  for (const name of ['api', 'mcp', 'minio', 'idp'])
    assert.equal(Object.keys(c.services[name].networks).includes('copy-entry'), false);
  assert.ok(c.services.ui.networks['copy-entry']);
});
