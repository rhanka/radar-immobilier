import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
/* global fetch, AbortSignal */
const require = createRequire('/workspace/packages/immo-mcp/package.json');
const { SignJWT } = require('jose');

export async function openImageClient(environment, workspace) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic', alg: 'RS256', use: 'sig' };
  const upstream = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/.well-known/jwks.json' ? { keys: [jwk] } : { features: [] }));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const issuer = `http://127.0.0.1:${upstream.address().port}`;
  const resource = 'http://127.0.0.1:8848/mcp';
  const token = await new SignJWT({ client_id: 'image-proof', scope: 'immo:read immo:search immo:documents:read', workspaces: [workspace] })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).setIssuer(issuer).setAudience(resource)
    .setSubject('alice').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let child, session, sequence = 0, logs = '';
  const post = async (method, params) => {
    const response = await fetch(resource, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }), signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200, logs);
    if (method === 'initialize') session = response.headers.get('mcp-session-id');
    return response.json();
  };
  const stop = async () => {
    if (child?.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  };
  const start = async () => {
    session = undefined;
    child = spawn(process.execPath, ['packages/immo-mcp/dist/server-http.js'], { env: {
      PATH: process.env.PATH, NODE_ENV: 'test', ...environment, IMMO_MCP_OAUTH_ISSUER: issuer,
      IMMO_MCP_OAUTH_RESOURCE: resource, RADAR_API_BASE_URL: issuer,
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', (chunk) => { logs += chunk; });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { ready = (await fetch(resource, { signal: AbortSignal.timeout(200) })).status === 401; } catch { /* boot */ }
      if (ready) break;
      assert.equal(child.exitCode, null, logs); await delay(50);
    }
    assert.ok(ready, logs);
    await post('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'a5-proof', version: '1' } });
    assert.ok(session);
  };
  try { await start(); } catch (error) { await stop(); upstream.close(); throw error; }
  return { issuer, resource, get logs() { return logs; },
    list: async () => (await post('tools/list', {})).result.tools,
    call: async (name, args) => (await post('tools/call', { name, arguments: args })).result,
    async restart() { await stop(); await start(); },
    async close() { await stop(); await new Promise((resolve) => upstream.close(resolve)); },
  };
}
