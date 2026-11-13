/* global fetch, URL, URLSearchParams */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';

test('IdP recette : roster fermé, mot de passe, PKCE, nonce et code à usage unique', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutover-idp-'));
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  for (const [file, content] of Object.entries({ 'idp.key': keys.privateKey, 'idp.pub': keys.publicKey,
    'auth.json': JSON.stringify({ login: 'local-password', client: 'local-client', workload: 'local-workload' }),
    'roster.json': JSON.stringify([{ sub: 'synthetic-approved', manageMembers: true }]) }))
    writeFileSync(join(dir, file), content, { mode: 0o600 });
  const child = spawn(process.execPath, ['deploy/prod-cutover/rehearsal-idp.cjs'],
    { env: { ...process.env, REHEARSAL_AUTH_DIR: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; child.stderr.on('data', b => { errors += b; });
  try {
    let discovery;
    for (let i = 0; i < 50; i++) {
      try { discovery = await fetch('http://127.0.0.1:8080/.well-known/openid-configuration'); break; }
      catch { assert.equal(child.exitCode, null, errors); await setTimeout(100); }
    }
    assert.equal(discovery?.status, 200, errors);
    const verifier = 'v'.repeat(43);
    const query = new URLSearchParams({ client_id: 'radar-rehearsal', response_type: 'code',
      redirect_uri: 'https://recette.localhost:15321/api/v1/auth/oauth/callback',
      scope: 'openid profile email immo:search offline_access', nonce: 'expected-nonce', state: 'expected-state',
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    const authorize = (body, extra = '') => fetch(`http://127.0.0.1:8080/authorize?${query}${extra}`,
      { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' });
    assert.equal((await authorize({ account: '0', password: 'wrong' })).status, 401);
    assert.equal((await authorize({ account: '1', password: 'local-password' })).status, 401);
    query.set('scope', 'unsupported');
    assert.equal((await authorize({ account: '0', password: 'local-password' })).status, 400);
    query.set('scope', 'openid profile email immo:search offline_access');
    const login = await authorize({ account: '0', password: 'local-password' });
    assert.equal(login.status, 302);
    const callback = new URL(login.headers.get('location'));
    assert.equal(callback.searchParams.get('state'), 'expected-state');
    const form = new URLSearchParams({ client_id: 'radar-rehearsal', client_secret: 'local-client',
      grant_type: 'authorization_code', code: callback.searchParams.get('code'),
      redirect_uri: query.get('redirect_uri'), code_verifier: verifier });
    const token = () => fetch('http://127.0.0.1:8080/token', { method: 'POST', body: form });
    const response = await token(); assert.equal(response.status, 200);
    const { jwtVerify, importSPKI } = await import('jose');
    const tokens = await response.json();
    const payload = (await jwtVerify(tokens.id_token, await importSPKI(keys.publicKey, 'RS256'),
      { issuer: 'https://recette.localhost:15321/oidc', audience: 'radar-rehearsal' })).payload;
    assert.equal(payload.sub, 'synthetic-approved'); assert.equal(payload.nonce, 'expected-nonce');
    assert.equal((await token()).status, 400);
    const refresh = new URLSearchParams({ client_id: 'radar-rehearsal', client_secret: 'local-client',
      grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    const renewed = await fetch('http://127.0.0.1:8080/token', { method: 'POST', body: refresh });
    assert.equal(renewed.status, 200);
    assert.notEqual((await renewed.json()).refresh_token, tokens.refresh_token);
    assert.equal((await fetch('http://127.0.0.1:8080/token', { method: 'POST', body: refresh })).status, 400);
    const exchange = new URLSearchParams({ client_id: 'immo-mcp-workload', client_secret: 'local-workload',
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: tokens.access_token,
      audience: 'https://recette.localhost:15321', scope: 'immo:search' });
    const exchanged = await fetch('http://127.0.0.1:8080/token', { method: 'POST', body: exchange });
    assert.equal(exchanged.status, 200);
    const delegated = (await jwtVerify((await exchanged.json()).access_token, await importSPKI(keys.publicKey, 'RS256'),
      { audience: 'https://recette.localhost:15321' })).payload;
    assert.equal(delegated.sub, 'synthetic-approved'); assert.equal(delegated.act.sub, 'immo-mcp-workload');
    assert.equal(delegated.scope, 'immo:search'); assert.ok(delegated.exp <= payload.exp);
    const next = new URL((await authorize({ account: '0', password: 'local-password' })).headers.get('location'));
    form.set('code', next.searchParams.get('code')); form.set('code_verifier', 'invalid');
    assert.equal((await token()).status, 400);
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill();
    if (child.exitCode === null) await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});
