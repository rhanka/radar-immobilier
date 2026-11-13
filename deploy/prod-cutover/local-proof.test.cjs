/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('./runtime.cjs');
const proof = require('./local-proof.cjs');
test('refuse les consommateurs locaux actifs, les hooks et les preuves modifiées', () => {
  const before = { run: r.run, environment: process.env.ENV };
  const db = { Id: 'db-id', Config: { Labels: { 'com.docker.compose.project': 'radar-prod-copy-owner',
    'com.docker.compose.service': 'postgres' } }, State: { Running: true } };
  const api = { Id: 'api-id', Config: { Labels: {} }, State: { Running: false, FinishedAt: 'observed', ExitCode: 0 } };
  let hook = '';
  try {
    process.env.ENV = 'rehearsal';
    r.run = (bin, args) => args[0] === 'inspect' ? JSON.stringify([db, api])
      : args.includes('name=immo-6h-') ? hook : 'db-id\napi-id';
    const snapshot = { network: 'radar-prod-copy-owner_copy-only', databaseContainer: db.Id,
      containers: [{ id: api.Id, finishedAt: 'observed', exitCode: 0 }] };
    const e = { instances: [api.Id], localTermination: snapshot };
    proof.verify(e);
    api.State.Running = true;
    assert.throws(() => proof.verify(e), /local_consumers_not_terminated/);
    api.State.Running = false; hook = 'active-hook';
    assert.throws(() => proof.verify(e), /local_hook_not_terminated/);
    hook = ''; api.State.FinishedAt = 'restarted';
    assert.throws(() => proof.verify(e), /local_termination_proof_changed/);
    process.env.ENV = 'execution-prod';
    assert.throws(() => proof.verify(e), /local_termination_proof_required/);
  } finally {
    r.run = before.run;
    if (before.environment === undefined) delete process.env.ENV; else process.env.ENV = before.environment;
  }
});
