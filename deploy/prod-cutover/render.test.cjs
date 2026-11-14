/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render, contentIngress } = require('./render.cjs');
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
    assert.equal(data.ARTIFACTS_CONTENT_BASE, 'pages.immo.sent-tech.ca');
    assert.equal(Object.hasOwn(data, 'IMMO_ARTIFACTS_BUILDER_URL'), false);
    for (const key of ['ARTIFACTS_S3_BUCKET', 'ARTIFACTS_S3_ENDPOINT', 'ARTIFACTS_S3_REGION'])
      assert.ok(data[key]);
    assert.doesNotMatch(JSON.stringify(data), /preprod\.sent-tech|preprod\.immo|sentropic-preprod/);
  }
  const mcp = result.items.find(x => x.metadata.name === 'immo-mcp-config').data;
  assert.match(mcp.IMMO_MCP_OAUTH_SCOPES_SUPPORTED, /immo:artifacts:read immo:artifacts:write offline_access/);
  assert.equal(result.items.find(x => x.metadata.name === 'radar-cutover-6h').data['plan.json'], text);
});
test('content hostname is explicit and rejects URLs or wildcard input', () => {
  const text = JSON.stringify({ version: 1, accounts: [{}] });
  assert.equal(render(text, 'content.example.ca').items[0].data.ARTIFACTS_CONTENT_BASE, 'content.example.ca');
  const ingress = contentIngress('content.example.ca');
  assert.equal(ingress.spec.rules[0].host, '*.content.example.ca');
  assert.deepEqual(ingress.spec.tls[0].hosts, ['*.content.example.ca']);
  for (const host of ['https://pages.immo.sent-tech.ca', '*.pages.immo.sent-tech.ca', ''])
    assert.throws(() => render(text, host), /invalid_artifacts_content_host/);
});
