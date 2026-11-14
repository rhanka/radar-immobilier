import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../../tools/make/cutover-fixture.mjs';

test('private HTTPS routes upload, HTML and MCP through loopback while public Ingress stays closed', () => {
  const f = fixture();
  try {
    const closed = f.state();
    closed.objects.find(o => o.kind === 'Ingress').spec.defaultBackend.service.name = 'base-maintenance-original';
    writeFileSync(`${f.dir}/state.json`, JSON.stringify(closed));
    writeFileSync(join(f.dir, 'tls.input'), 'synthetic TLS placeholder');
    writeFileSync(join(f.dir, 'record.json'), JSON.stringify({ release: f.release }));
    writeFileSync(join(f.dir, 'bin/docker'), `#!/bin/bash
if [[ $1 == run ]]; then
  printf '%s\\n' "$@" > "$CUTOVER_TEST_STATE/docker-args"
  for arg in "$@"; do
    if [[ $arg == *private-nginx.conf:/private/nginx.conf:ro ]]; then
      cp "\${arg%%:/private/*}" "$CUTOVER_TEST_STATE/served.conf"
    fi
  done
fi
`, { mode: 0o755 });
    const script = `set -euo pipefail
fail() { echo "$*" >&2; exit 1; }
start_forward() { printf 'Forwarding from 127.0.0.1:18888 -> 3000\\n' > "$3"; }
source deploy/prod-cutover/private-https.sh
private_https`;
    const env = { ...f.env, WORK: f.dir, RUN: '00000000-0000-0000-0000-000000000001',
      TLS_CERT: `${f.dir}/tls.input`, TLS_KEY: `${f.dir}/tls.input`,
      CONTENT_TLS_CERT: `${f.dir}/tls.input`, CONTENT_TLS_KEY: `${f.dir}/tls.input`,
      ARTIFACTS_CONTENT_HOST: 'pages.example.test' };
    const result = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const config = readFileSync(`${f.dir}/served.conf`, 'utf8');
    assert.equal((config.match(/listen 127\.0\.0\.2:443 ssl;/g) || []).length, 2);
    assert.match(config, /server_name \.pages\.example\.test/);
    for (const path of ['/api/', '/mcp', '/']) assert.ok(config.includes(`location ${path} `));
    assert.match(config, /X-Forwarded-Proto https/);
    assert.match(config, /access_log off/);
    assert.match(readFileSync(`${f.dir}/docker-args`, 'utf8'), /ca.sent-tech.immo.cutover-run=/);
    assert.deepEqual(f.state(), closed);
    const refused = spawnSync('bash', ['-c', script], { env: { ...env, TLS_KEY: '/private/.env' }, encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Fichier TLS privé explicite requis/);
  } finally { f.cleanup(); }
});
