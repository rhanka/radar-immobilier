/* global require, process, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('./runtime.cjs');
const { provision, roleUrl } = require('./provision-prod.cjs');
test('provision defaults to read-only inventory and refuses missing permissions or conflicting objects', () => {
  const saved = { run: r.run, ENV: process.env.ENV, APPLY: process.env.APPLY };
  process.env.ENV = 'prod'; delete process.env.APPLY;
  let denied = false; let conflict = false;
  const calls = [];
  r.run = (bin, args, options) => {
    calls.push(args);
    assert.equal(bin, 'kubectl');
    assert.ok(args.includes('--kubeconfig'));
    assert.ok(args.includes('can-i') || !args.some(arg => arg === 'create' || arg === 'apply'));
    if (args.includes('config')) return 'https://hlhedx.c1.bhs5.k8s.ovh.net';
    if (args.includes('can-i')) return denied ? 'no' : 'yes';
    if (args.includes('exec')) {
      assert.ok(args.some(arg => arg.includes('default_transaction_read_only=on')));
      assert.match(options.input, /^SELECT/);
      return JSON.stringify({ db: 'radar', admin: true, roles: [] });
    }
    if (args.includes('pods')) return JSON.stringify({ items: [{ metadata: { name: 'radar-postgres-0' }, status: { phase: 'Running' } }] });
    if (conflict && args.includes('Ingress')) return JSON.stringify({ spec: { rules: [] } });
    return '';
  };
  try {
    const result = provision();
    assert.equal(result.mode, '--dry-run'); assert.equal(result.dotenvRead, false);
    assert.equal(result.plan.length, 9);
    denied = true; assert.throws(provision, /permission_missing/); denied = false;
    conflict = true; assert.throws(provision, /resource_conflict/);
    process.env.APPLY = 'yes'; assert.throws(provision, /lane_refused/);
    assert.ok(calls.length);
  } finally {
    r.run = saved.run;
    for (const key of ['ENV', 'APPLY']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});
test('MCP URL identity is checked before any create', () => {
  const object = url => ({ data: { url: Buffer.from(url).toString('base64') } });
  assert.throws(() => roleUrl(object('postgresql://admin:dummy@elsewhere/radar'), 'url', 'immo_mcp_artifact_writer'), /mismatch/);
  assert.equal(roleUrl(object('postgresql://immo_mcp_artifact_writer:dummy@radar-postgres:5432/radar'), 'url', 'immo_mcp_artifact_writer'), 'dummy');
});
