/* global require, process, setTimeout, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const r = require('./runtime.cjs');
test('real candidate nginx serves private TLS for publication, content and MCP', async () => {
  const dir = r.fs.mkdtempSync('/tmp/private-tls-test-');
  const run = r.crypto.randomUUID();
  const servers = [];
  let child;
  let diagnostic = '';
  try {
    const ports = {};
    for (const name of ['ui', 'api', 'mcp']) {
      const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`${name}:${req.url}:${req.headers.host}:${req.headers['x-forwarded-proto']}`);
      });
      servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
      ports[name] = server.address().port;
    }
    r.run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-config', '/dev/null',
      '-keyout', `${dir}/key`, '-out', `${dir}/cert`, '-subj', '/CN=immo.sent-tech.ca',
      '-addext', 'subjectAltName=DNS:immo.sent-tech.ca,DNS:*.pages.example.test', '-days', '1']);
    r.fs.writeFileSync(`${dir}/record.json`, JSON.stringify({ release: r.json(`${__dirname}/release.json`) }));
    const script = `set -euo pipefail
fail() { exit 1; }
start_forward() {
  case "$1" in radar-ui) port=${ports.ui};; radar-api) port=${ports.api};; radar-immo-mcp) port=${ports.mcp};; esac
  printf 'Forwarding from 127.0.0.1:%s -> 3000\\n' "$port" > "$3"
}
source deploy/prod-cutover/private-https.sh
private_https`;
    child = spawn('bash', ['-c', script], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, WORK: dir,
      RUN: run, TLS_CERT: `${dir}/cert`, TLS_KEY: `${dir}/key`,
      CONTENT_TLS_CERT: `${dir}/cert`, CONTENT_TLS_KEY: `${dir}/key`, ARTIFACTS_CONTENT_HOST: 'pages.example.test' } });
    child.stderr.on('data', data => { diagnostic += data; });
    const get = (host, path, method = 'GET') => new Promise((resolve, reject) => {
      const req = https.request({ hostname: '127.0.0.2', port: 443, servername: host, path, method,
        headers: { Host: host }, ca: r.fs.readFileSync(`${dir}/cert`), timeout: 1000 }, res => {
        let body = ''; res.on('data', b => { body += b; }); res.on('end', () => resolve(body));
      });
      req.on('error', reject); req.on('timeout', () => req.destroy()); req.end();
    });
    let ready = false;
    let lastError = '';
    for (let n = 0; n < 40; n++) {
      if (child.exitCode !== null) assert.fail(`Private TLS container exited before readiness: ${diagnostic}`);
      try { await get('immo.sent-tech.ca', '/'); ready = true; break; } catch (error) { lastError = error.message; await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.ok(ready, `Private TLS listener must start: ${lastError}; ${diagnostic}`);
    assert.equal(await get('immo.sent-tech.ca', '/api/v1/artifacts', 'POST'), 'api:/api/v1/artifacts:immo.sent-tech.ca:https');
    assert.equal(await get('page.pages.example.test', '/index.html'), 'api:/index.html:page.pages.example.test:https');
    assert.equal(await get('immo.sent-tech.ca', '/mcp', 'POST'), 'mcp:/mcp:immo.sent-tech.ca:https');
  } finally {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
    require('./containers.cjs').stop(run);
    require('./containers.cjs').guard(run);
    for (const server of servers) server.close();
    r.fs.rmSync(dir, { recursive: true, force: true });
  }
});
