/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('./runtime.cjs');
const { read } = require('./local-query.cjs');
test('the copy reader is read-only and refuses every other destination before Docker', () => {
  const prior = { ...process.env }; const run = r.run;
  const valid = { ENV: 'rehearsal', PGHOST: '127.0.0.1', PGPORT: '25433', PGDATABASE: 'radar_cutover_owner_20261113' };
  try {
    Object.assign(process.env, valid);
    r.run = (bin, args, options) => {
      assert.equal(bin, 'docker');
      assert.ok(args.includes('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000'));
      assert.ok(args.includes('PGAPPNAME=radar-prod-copy-read'));
      assert.equal(options.input, 'SELECT 1');
      return '1\n';
    };
    assert.equal(read('SELECT 1'), '1');
    r.run = () => assert.fail('No Docker access outside the copy');
    for (const patch of [{ ENV: 'prod' }, { PGHOST: 'remote' }, { PGPORT: '5432' }, { PGDATABASE: 'radar' }]) {
      Object.assign(process.env, valid, patch);
      assert.throws(() => read('SELECT 1'), /local_copy_read_only/);
    }
  } finally {
    r.run = run;
    for (const key of Object.keys(valid)) {
      if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    }
  }
});
