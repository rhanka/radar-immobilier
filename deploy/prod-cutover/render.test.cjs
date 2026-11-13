/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('./render.cjs');
test('rend les statiques et scopes MCP avec toutes les portes live fermées', () => {
  const text = JSON.stringify({ version: 1, accounts: [{ sub: 'synthetic' }] }) + '\n';
  const result = render(text);
  assert.equal(result.items.length, 4);
  for (const item of result.items) assert.equal(item.metadata.namespace, 'radar-immobilier');
  for (const name of ['radar-api', 'immo-mcp-config']) {
    const { data } = result.items.find(x => x.metadata.name === name);
    assert.equal(data.ARTIFACTS_CONTROL_MODE, 'general');
    assert.equal(data.IMMO_ARTIFACTS_GIT_MODE, 'off');
    assert.equal(data.IMMO_ARTIFACTS_LIVE_EDGE_ENABLED, '0');
    for (const key of ['QUALIFIED', 'INVITATIONS_QUALIFIED', 'REDRIVE_ENABLED'])
      assert.equal(data[`IMMO_ARTIFACTS_LIVE_${key}`], 'false');
    assert.equal(data.ARTIFACTS_STORAGE_SCOPE, 'radar-immobilier');
    assert.doesNotMatch(JSON.stringify(data), /preprod\.sent-tech|preprod\.immo|sentropic-preprod/);
  }
  const mcp = result.items.find(x => x.metadata.name === 'immo-mcp-config').data;
  assert.match(mcp.IMMO_MCP_OAUTH_SCOPES_SUPPORTED, /immo:artifacts:read immo:artifacts:write offline_access/);
  assert.equal(result.items.find(x => x.metadata.name === 'radar-cutover-6h').data['plan.json'], text);
});
