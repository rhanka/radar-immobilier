/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { retention, merged } = require('./configmap-merge.cjs');
const { render } = require('./render.cjs');
const settings = require('./prod-settings.json');
// Flat `KEY: "value"` lines of the first ConfigMap data block of a repository manifest.
function repoData(file, name) {
  const text = fs.readFileSync(path.join(__dirname, '../k8s', file), 'utf8');
  const doc = text.split(/^---$/m).find(d => /kind: ConfigMap/.test(d) && new RegExp(`name: ${name}\\n`).test(d));
  const data = {};
  for (const [, key, value] of doc.split(/^data:$/m)[1].matchAll(/^ {2}([A-Z0-9_]+): "(.*)"$/gm)) data[key] = value;
  return data;
}
const INCIDENT = {
  'radar-api': ['NODE_ENV', 'PORT', 'NODE_OPTIONS', 'POSTGRES_HOST', 'POSTGRES_PORT', 'OBSCURA_CDP_URL',
    'SCW_TEM_API_BASE_URL', 'SCW_TEM_REGION', 'SCW_TEM_PROJECT_ID', 'SCW_TEM_FROM_EMAIL', 'SCW_TEM_FROM_NAME',
    'SESSION_TTL_SECONDS', 'SESSION_ABSOLUTE_TTL_SECONDS'],
  'immo-mcp-config': ['IMMO_MCP_DATA_MODE', 'IMMO_MCP_EXCHANGE_POLICY_REV', 'IMMO_MCP_HTTP_PORT', 'NODE_OPTIONS', 'RADAR_API_BASE_URL'],
};
const live = () => ({ kind: 'List', items: [
  { metadata: { name: 'radar-api' }, data: repoData('30-api.yaml', 'radar-api') },
  { metadata: { name: 'immo-mcp-config' }, data: repoData('immo-mcp/40-immo-mcp-http-deploy.yaml', 'immo-mcp-config') },
] });
const rendered = () => render(JSON.stringify({ version: 1, accounts: [{ sub: 'synthetic' }] })).items;
test('incident 14/11 : ConfigMap complète + rendu partiel, aucune clé perdue', () => {
  const before = live();
  for (const item of rendered()) {
    const current = before.items.find(x => x.metadata.name === item.metadata.name);
    if (!current) continue;
    // Former semantics: client-side apply replaced data with the partial render.
    const lostByApply = Object.keys(current.data).filter(key => !Object.hasOwn(item.data, key));
    for (const key of INCIDENT[item.metadata.name]) assert.ok(lostByApply.includes(key), key);
    // Merge semantics: every live key survives and every rendered key wins.
    const result = merged(current, item);
    for (const key of Object.keys(current.data)) assert.ok(Object.hasOwn(result, key), key);
    for (const [key, value] of Object.entries(item.data)) assert.equal(result[key], value);
    assert.equal(result.POSTGRES_HOST ?? result.RADAR_API_BASE_URL, current.data.POSTGRES_HOST ?? current.data.RADAR_API_BASE_URL);
  }
  const report = retention(rendered(), before);
  assert.deepEqual(report.map(x => x.name), ['radar-api', 'immo-mcp-config', 'radar-mcp-receiver']);
});
test('les clés conservées existent dans les ConfigMaps du dépôt', () => {
  assert.deepEqual(settings.retained, INCIDENT);
  for (const item of live().items)
    for (const key of settings.retained[item.metadata.name]) assert.ok(Object.hasOwn(item.data, key), key);
});
test('configuration-check refuse une perte de clé, une valeur nulle ou une live absente', () => {
  assert.throws(() => retention(rendered(), null), /live_configuration_required/);
  // Live unreadable or map absent: the partial render alone would drop the incident keys.
  assert.throws(() => retention(rendered(), { kind: 'List', items: [] }), /configuration_retained_key_missing/);
  const nulled = rendered(); nulled[0].data.NODE_ENV = null;
  assert.throws(() => retention(nulled, live()), /configuration_value_invalid/);
  const empty = rendered(); empty[1].data = {};
  assert.throws(() => retention(empty, live()), /configuration_value_invalid/);
});
test('le rendu porte les clés appliquées à la main pendant la bascule', () => {
  const items = rendered();
  const api = items.find(x => x.metadata.name === 'radar-api').data;
  assert.equal(api.SENTROPIC_IDP_ISSUER, 'https://auth.sent-tech.ca');
  assert.equal(api.SENTROPIC_IDP_JWKS_URL, 'https://auth.sent-tech.ca/.well-known/jwks.json');
  assert.equal(api.SENTROPIC_OAUTH_CLIENT_ID, 'radar-immobilier');
  assert.equal(api.SENTROPIC_OAUTH_SCOPES, 'openid profile email');
  assert.equal(api.AUTH_CALLBACK_BASE_URL, 'https://immo.sent-tech.ca');
  assert.equal(api.SENTROPIC_OAUTH_REDIRECT_URI, 'https://immo.sent-tech.ca/api/v1/auth/oauth/callback');
  assert.doesNotMatch(JSON.stringify(api), /SECRET|PASSWORD|TOKEN/);
  assert.deepEqual(items.find(x => x.metadata.name === 'radar-mcp-receiver').data, {
    MCP_SIGNAL_SEARCH_ENABLED: '1', STRICT_RECEIVER_ARMED: '0', STRICT_RECEIVER_ENVIRONMENT: 'production',
    STRICT_RECEIVER_WORKLOAD_CLIENT_ID: 'immo-mcp-workload', STRICT_RECEIVER_WORKLOAD_SUB: 'immo-mcp-workload' });
});
