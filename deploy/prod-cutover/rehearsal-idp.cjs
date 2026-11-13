/* global require, process, Buffer, URL, URLSearchParams */
/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated rehearsal issuer. Keys and credentials are generated locally, never reused in prod.
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
async function main() {
  const { SignJWT, importPKCS8, exportJWK, importSPKI, jwtVerify } = await import('/workspace/node_modules/jose/dist/webapi/index.js');
  const dir = process.env.REHEARSAL_AUTH_DIR || '/private';
  const c = JSON.parse(readFileSync(`${dir}/auth.json`));
  const roster = JSON.parse(readFileSync(`${dir}/roster.json`));
  const issuer = 'https://recette.localhost:15321/oidc';
  const origin = 'https://recette.localhost:15321';
  const key = await importPKCS8(readFileSync(`${dir}/idp.key`, 'utf8'), 'RS256');
  const publicKey = await importSPKI(readFileSync(`${dir}/idp.pub`, 'utf8'), 'RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'rehearsal', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const refresh = new Map();
  const renew = grant => {
    if (!grant.scope.split(' ').includes('offline_access')) return {};
    const value = randomUUID(); refresh.set(value, { ...grant, expires: Date.now() + 3600000 });
    return { refresh_token: value };
  };
  const scopes = 'openid profile email immo:read immo:search immo:documents:read immo:artifacts:read immo:artifacts:write offline_access';
  const sign = (sub, aud, claims = {}, expires = Math.floor(Date.now() / 1000) + 300) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(issuer).setSubject(sub).setAudience(aud).setIssuedAt().setExpirationTime(expires).sign(key);
  const server = createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      const u = new URL(req.url, issuer);
      if (req.method === 'GET' && u.pathname === '/.well-known/openid-configuration') return send(200, {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`, response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
        code_challenge_methods_supported: ['S256'], scopes_supported: scopes.split(' '),
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      });
      if (req.method === 'GET' && u.pathname === '/.well-known/jwks.json') return send(200, { keys: [jwk] });
      if (u.pathname === '/authorize') {
        const p = u.searchParams;
        const client = p.get('client_id');
        const redirect = p.get('redirect_uri');
        if (!['radar-rehearsal', 'immo-mcp-rehearsal'].includes(client)
          || (client === 'radar-rehearsal' ? redirect !== `${origin}/api/v1/auth/oauth/callback`
            : !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/[a-zA-Z0-9/_-]*$/.test(redirect || ''))
          || p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256'
          || !/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge') || '')
          || (p.get('scope') || '').split(' ').some(s => !scopes.split(' ').includes(s))) return send(400, { error: 'invalid_request' });
        if (req.method === 'GET') return send(200,
          `<form method="post"><label>Compte <select name="account">${roster.map((a, i) =>
            `<option value="${i}">Compte ${i + 1}${a.manageMembers ? ' gestionnaire' : ''}${a.moderateArchive ? ' modérateur' : ''}</option>`).join('')}</select></label><label>Mot de passe recette <input name="password" type="password"></label><button>Connexion locale</button></form>`, 'text/html');
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw Error(); }
        const form = new URLSearchParams(body);
        const account = roster[Number(form.get('account'))];
        if (form.get('password') !== c.login || !form.has('account') || !account) return send(401, { error: 'access_denied' });
        const code = randomUUID();
        codes.set(code, { sub: account.sub, client, redirect, nonce: p.get('nonce'),
          challenge: p.get('code_challenge'), scope: p.get('scope') || '', expires: Date.now() + 60000 });
        const callback = new URL(redirect); callback.searchParams.set('code', code);
        if (p.has('state')) callback.searchParams.set('state', p.get('state'));
        res.writeHead(302, { Location: callback.href }); return res.end();
      }
      if (req.method !== 'POST' || u.pathname !== '/token') return send(404, {});
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw Error(); }
      const form = new URLSearchParams(body);
      const basic = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
      const client = form.get('client_id') || basic[0];
      const secret = form.get('client_secret') || basic[1];
      if (form.get('grant_type') === 'refresh_token') {
        const grant = refresh.get(form.get('refresh_token')); refresh.delete(form.get('refresh_token'));
        if (!grant || grant.expires < Date.now() || client !== grant.client
          || (client === 'radar-rehearsal' && secret !== c.client)) return send(400, { error: 'invalid_grant' });
        return send(200, { access_token: await sign(grant.sub, `${origin}/mcp`, { scope: grant.scope, client_id: client }),
          token_type: 'Bearer', expires_in: 300, scope: grant.scope, ...renew(grant) });
      }
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:token-exchange') {
        if (client !== 'immo-mcp-workload' || secret !== c.workload || form.get('audience') !== origin
          || form.get('scope') !== 'immo:search') return send(401, { error: 'invalid_client' });
        const { payload } = await jwtVerify(form.get('subject_token'), publicKey, { issuer, audience: `${origin}/mcp` });
        if (!roster.some(a => a.sub === payload.sub) || !(payload.scope || '').split(' ').includes('immo:search'))
          return send(403, { error: 'access_denied' });
        const expires = Math.min(payload.exp, Math.floor(Date.now() / 1000) + 300);
        return send(200, { access_token: await sign(payload.sub, origin, { scope: 'immo:search',
          client_id: client, act: { sub: client } }, expires), token_type: 'Bearer', expires_in: expires - Math.floor(Date.now() / 1000),
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: 'immo:search' });
      }
      const grant = codes.get(form.get('code')); codes.delete(form.get('code'));
      if (form.get('grant_type') !== 'authorization_code' || !grant || grant.expires < Date.now()
        || client !== grant.client || form.get('redirect_uri') !== grant.redirect
        || createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') !== grant.challenge
        || (client === 'radar-rehearsal' && secret !== c.client)) return send(400, { error: 'invalid_grant' });
      return send(200, { id_token: await sign(grant.sub, client, { nonce: grant.nonce }),
        access_token: await sign(grant.sub, `${origin}/mcp`, { scope: grant.scope, client_id: client }),
        token_type: 'Bearer', expires_in: 300, scope: grant.scope, ...renew(grant) });
    } catch { send(400, { error: 'invalid_request' }); }
  });
  server.listen(8080, '0.0.0.0');
}
main().catch(() => { process.stderr.write('local_idp_failed\n'); process.exitCode = 1; });
