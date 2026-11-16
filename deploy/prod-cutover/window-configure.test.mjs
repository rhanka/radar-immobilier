import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fixture } from '../../tools/make/cutover-fixture.mjs';

const FULL = { NODE_ENV: 'production', PORT: '3000', NODE_OPTIONS: '--dns-result-order=ipv4first --max-old-space-size=512',
  POSTGRES_HOST: 'radar-postgres', POSTGRES_PORT: '5432', OBSCURA_CDP_URL: 'http://radar-obscura:9222',
  SCW_TEM_API_BASE_URL: 'https://api.scaleway.com', SCW_TEM_REGION: 'fr-par', SCW_TEM_PROJECT_ID: 'synthetic',
  SCW_TEM_FROM_EMAIL: 'no-reply@example.test', SCW_TEM_FROM_NAME: 'Radar',
  SESSION_TTL_SECONDS: '1296000', SESSION_ABSOLUTE_TTL_SECONDS: '2592000', ARTIFACTS_CONTROL_MODE: 'old' };
const mcpRoute = exact => ({ kind: 'Ingress', metadata: { name: 'radar-immo-mcp', uid: 'uid-radar-immo-mcp', resourceVersion: '1' },
  spec: { rules: [{ host: 'immo.sent-tech.ca', http: { paths: [
    { path: '/mcp', pathType: 'Prefix', backend: { service: { name: 'radar-immo-mcp', port: { name: 'http' } } } },
    ...(exact ? [{ path: '/.well-known/oauth-protected-resource/mcp', pathType: 'Exact',
      backend: { service: { name: 'radar-immo-mcp', port: { name: 'http' } } } }] : [])] } }] } });

function setup(change) {
  const f = fixture({ url: 'https://immo.sent-tech.ca' });
  writeFileSync(join(f.dir, 'bin/docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // Only the application port is doubled; kubectl goes through the stateful boundary.
  writeFileSync(join(f.dir, 'bin/node'), `#!/bin/sh
if [ "$1" = deploy/prod-cutover/cli.cjs ]; then exit 0; fi
exec '${process.execPath}' "$@"
`, { mode: 0o755 });
  writeFileSync(join(f.dir, 'bin/gh'), '#!/bin/sh\nprintf \'{"workflow_runs":[]}\\n\'\n', { mode: 0o755 });
  const state = f.state();
  state.objects.find(o => o.kind === 'ConfigMap' && o.metadata.name === 'radar-api').data = { ...FULL };
  change(state);
  writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
  const run = (action, id) => spawnSync('make', ['-s', '-f', 'deploy/prod-cutover/prod-cutover.mk', action,
    `RELEASE=${f.dir}/release.json`, `PREVIOUS_RELEASE=${f.dir}/release.json`, `CONFIGURATION=${f.dir}/configuration.json`,
    ...(id ? [`RUN=${id}`] : []), 'ENV=execution-prod'], { env: f.env, encoding: 'utf8', timeout: 30000 });
  return { f, run };
}
const lockRun = f => JSON.parse(f.state().objects.find(o => o.metadata.name === 'radar-change-lock').data.record).run;

test('incident 14/11 : window-configure fusionne le rendu partiel sans perdre de clé', () => {
  const { f, run } = setup(state => state.objects.push(mcpRoute(true)));
  try {
    const start = run('window-start');
    assert.equal(start.status, 0, start.stdout + start.stderr);
    const plan = f.state().objects.find(o => o.metadata.name === 'radar-cutover-6h');
    writeFileSync(join(f.dir, 'configuration.json'), JSON.stringify({ apiVersion: 'v1', kind: 'List', items: [
      { kind: 'ConfigMap', metadata: { name: 'radar-api', namespace: 'radar-immobilier' },
        data: { ARTIFACTS_CONTROL_MODE: 'general', SENTROPIC_OAUTH_CLIENT_ID: 'radar-immobilier' } },
      { kind: 'ConfigMap', metadata: { name: 'immo-mcp-config', namespace: 'radar-immobilier' },
        data: { IMMO_MCP_EXCHANGE_ENV: 'production' } },
      { ...plan, metadata: { name: 'radar-cutover-6h', namespace: 'radar-immobilier' } }] }));
    const configured = run('window-configure', lockRun(f));
    assert.equal(configured.status, 0, configured.stdout + configured.stderr);
    const maps = Object.fromEntries(f.state().objects.filter(o => o.kind === 'ConfigMap').map(o => [o.metadata.name, o.data]));
    assert.deepEqual(maps['radar-api'], { ...FULL, ARTIFACTS_CONTROL_MODE: 'general', SENTROPIC_OAUTH_CLIENT_ID: 'radar-immobilier' });
    assert.deepEqual(maps['immo-mcp-config'], { IMMO_MCP_EXCHANGE_ENV: 'production' });
    assert.equal(maps['radar-cutover-6h']['plan.json'], plan.data['plan.json']);
    const calls = f.calls().filter(c => c[0] === 'kubectl');
    assert.ok(calls.some(c => c.includes('patch') && c.includes('--type=merge') && c.includes('radar-api')));
    assert.ok(!calls.some(c => c.includes('apply') && c.some(a => a.endsWith('/configuration.json'))), 'no apply of the partial render');
  } finally { f.cleanup(); }
});
test('window-start refuse sans NetworkPolicy MCP vers PostgreSQL', () => {
  const { f, run } = setup(state => { state.objects = state.objects.filter(o => o.metadata.name !== 'allow-immo-mcp-to-postgres'); });
  try {
    const result = run('window-start');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /allow-immo-mcp-to-postgres is absent/);
  } finally { f.cleanup(); }
});
test('window-start refuse un ingress radar-immo-mcp sans la route PRM exacte', () => {
  const { f, run } = setup(state => state.objects.push(mcpRoute(false)));
  try {
    const result = run('window-start');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lacks the Exact \/\.well-known\/oauth-protected-resource\/mcp route/);
  } finally { f.cleanup(); }
});
