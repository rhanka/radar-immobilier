/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('./runtime.cjs');
const { main } = require('./cli.cjs');
test('abandon refuses a changed schema without consulting backup receipts', async () => {
  const prior = { destination: r.destination, mutationGuard: r.mutationGuard, rows: r.rows, receipt: r.receipt };
  try {
    r.destination = r.mutationGuard = () => {};
    r.receipt = () => assert.fail('Backup receipt must not be required');
    const entries = r.journal();
    const rows = n => entries.slice(0, n).map(e => ({ hash: e.hash, created_at: e.when }));
    r.rows = () => rows(14);
    await assert.rejects(main('abort-verify'), /historical_schema_required/);
    r.rows = () => rows(13);
    await main('abort-verify');
    r.mutationGuard = () => r.fail('change_lock_ownership_required');
    await assert.rejects(main('abort-verify'), /change_lock_ownership_required/);
  } finally { Object.assign(r, prior); }
});
test('post-reopen recovery requires owner acceptance of lost later writes and exact RUN', async () => {
  const prior = { destination: r.destination, json: r.json };
  const run = process.env.RUN;
  try {
    r.destination = () => {};
    process.env.RUN = 'initial-run';
    const go = { run: 'initial-run', rollbackAfterReopen: true, acceptPostReopenWriteLoss: true };
    for (const patch of [{ run: 'other' }, { rollbackAfterReopen: false }, { acceptPostReopenWriteLoss: false }]) {
      r.json = () => ({ ...go, ...patch });
      await assert.rejects(main('recover-authorize'), /post_reopen_loss_approval_required/);
    }
    r.json = () => go;
    await main('recover-authorize');
  } finally {
    Object.assign(r, prior);
    if (run === undefined) delete process.env.RUN; else process.env.RUN = run;
  }
});
