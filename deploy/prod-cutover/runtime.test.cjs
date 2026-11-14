/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('PG authorization works before evidence exists and keeps explicit run ownership', () => {
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  const saved = { RUN: process.env.RUN, EVIDENCE: process.env.EVIDENCE };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-runtime-'));
  const labels = [];
  try {
    cp.spawnSync = (_bin, _args, options) => {
      labels.push(options.env.CUTOVER_CONTAINER_RUN);
      return { status: 0, stdout: 'radar\n' };
    };
    delete require.cache[require.resolve('./runtime.cjs')];
    const r = require('./runtime.cjs');
    delete process.env.RUN;
    process.env.EVIDENCE = path.join(dir, 'drain.json');
    assert.equal(r.sql('SELECT current_database();'), 'radar');
    r.sql('SELECT current_database();');
    assert.match(labels[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(labels[0], labels[1]);
    const evidenceRun = '11111111-1111-4111-8111-111111111111';
    fs.writeFileSync(process.env.EVIDENCE, JSON.stringify({ run: evidenceRun }));
    r.sql('SELECT current_database();');
    assert.equal(labels[2], evidenceRun);
    process.env.RUN = '22222222-2222-4222-8222-222222222222';
    r.sql('SELECT current_database();');
    assert.equal(labels[3], process.env.RUN);
  } finally {
    cp.spawnSync = original;
    delete require.cache[require.resolve('./runtime.cjs')];
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true });
  }
});
