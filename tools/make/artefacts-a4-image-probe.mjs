import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { exerciseDisconnects } from './artefacts-a4-disconnect.mjs';
/* global fetch, AbortSignal */
const require = createRequire('/workspace/packages/immo-mcp/package.json');
const { SignJWT } = require('jose');
const { Pool } = require('pg');
for (const [name, version] of [['cluster-mesh', '0.22.0'], ['artifacts', '0.2.0'], ['mcp-platform', '0.4.0'], ['mcp-auth', '0.2.1']]) {
  const installed = ['/workspace/packages/immo-mcp/node_modules', '/workspace/node_modules']
    .map((base) => `${base}/@sentropic/${name}/package.json`).find(existsSync);
  assert.ok(installed, name);
  const metadata = JSON.parse(readFileSync(installed));
  assert.equal(metadata.version, version);
  console.log('runtime package', name, version);
}
const db = new Pool({ connectionString: 'postgres://radar:synthetic-only@postgres:5432/radar' });
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await db.query('CREATE TABLE account_users (id uuid PRIMARY KEY, sub text UNIQUE, status text)');
await db.query('CREATE TABLE workspace_memberships (workspace_id uuid, account_id uuid, status text, revoked_at timestamptz)');
await db.query('INSERT INTO account_users VALUES ($1, $2, $3)', [id, 'alice', 'approved']);
await db.query('INSERT INTO workspace_memberships VALUES ($1, $1, $2, NULL)', [id, 'active']);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic', alg: 'RS256', use: 'sig' };
let reads = 0;
const upstream = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/.well-known/jwks.json') return res.end(JSON.stringify({ keys: [jwk] }));
  reads++;
  assert.equal(req.headers.authorization, undefined);
  res.end(JSON.stringify({ features: [], numberMatched: 0 }));
}).listen(0, '127.0.0.1');
await once(upstream, 'listening');
const issuer = `http://127.0.0.1:${upstream.address().port}`;
const resource = 'http://127.0.0.1:8848/mcp';
const bearer = await new SignJWT({ client_id: 'synthetic-cli', scope: 'immo:read immo:search immo:documents:read', workspaces: [id] })
  .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).setIssuer(issuer).setAudience(resource)
  .setSubject('alice').setIssuedAt().setExpirationTime('5m').sign(privateKey);
const child = spawn(process.execPath, ['packages/immo-mcp/dist/server-http.js'], {
  env: { PATH: process.env.PATH, NODE_ENV: 'test', IMMO_MCP_OAUTH_ISSUER: issuer,
    IMMO_MCP_OAUTH_RESOURCE: resource, RADAR_API_BASE_URL: issuer,
    IMMO_MCP_ACCOUNT_DATABASE_URL: 'postgres://radar:synthetic-only@postgres:5432/radar?application_name=a4-mcp-account' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stderr.on('data', (chunk) => { logs += chunk; });
const post = (message, session) => fetch(resource, { method: 'POST', headers: {
  authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
  ...(session ? { 'mcp-session-id': session } : {}),
}, body: JSON.stringify(message), signal: AbortSignal.timeout(3000) });
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { ready = (await fetch(resource, { signal: AbortSignal.timeout(300) })).status === 401; } catch { /* boot */ }
    if (ready) break;
    assert.equal(child.exitCode, null, logs);
    await delay(100);
  }
  assert.ok(ready, logs);
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'image-proof', version: '1' },
  } });
  assert.equal(init.status, 200, logs);
  const session = init.headers.get('mcp-session-id'); assert.ok(session);
  await init.json();
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, session)).json();
  assert.equal(list.result.tools.length, 12);
  assert.ok(list.result.tools.every((tool) => !tool.name.startsWith('artifacts_')));
  const call = async () => (await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'get_zones_geojson', arguments: { city: 'synthetic' },
  } }, session)).json()).result;
  assert.notEqual((await call()).isError, true); assert.equal(reads, 1);
  await db.query("UPDATE account_users SET status = 'suspended'");
  assert.equal((await call()).isError, true); assert.equal(reads, 1);
  await db.query("UPDATE account_users SET status = 'approved'");
  await db.query("UPDATE workspace_memberships SET status = 'revoked', revoked_at = now()");
  assert.equal((await call()).isError, true); assert.equal(reads, 1);
  await db.query("UPDATE workspace_memberships SET status = 'active', revoked_at = NULL");
  assert.notEqual((await call()).isError, true); assert.equal(reads, 2);
  await exerciseDisconnects({ db, child, call, readCount: () => reads });
  assert.match(logs, /"kind":"immo-mcp.account","error":"account_binding_unavailable","retriable":true/);
  assert.doesNotMatch(logs, /postgres:\/\/|terminating connection due to administrator command/);
  writeFileSync('/evidence/image-proof.json', JSON.stringify({ passed: true, tools: list.result.tools,
    businessReads: reads, accountRevocationDenied: true, membershipRevocationDenied: true,
    idleDisconnectSurvived: true, activeDisconnectRetriable: true, sameSessionRecovered: true }));
  console.log('PASS actual runtime: 12 tools, one effect per allowed call, fresh account/membership refusals');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  }
  writeFileSync('/evidence/mcp-runtime.log', logs);
  await db.query('DROP TABLE workspace_memberships, account_users');
  await new Promise((done) => upstream.close(done)); await db.end();
}
