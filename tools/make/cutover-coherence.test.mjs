import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';

const config = readFileSync('deploy/cutover/config.json', 'utf8');
const jq = (file, record, args = []) => {
  const r = spawnSync('jq', ['-c', ...args, '-f', file], { input: JSON.stringify(record), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const coherence = (record) => jq('tools/make/cutover-coherence.jq', record);
const coupled = (record, env = 'preprod') => jq('tools/make/cutover-coupled.jq', record, ['--argjson', 'cfg', config, '--arg', 'env', env]);

const D = '2026-11-14';
const M = 'a'.repeat(64);
const P = 'b'.repeat(64);
const aligned = () => ({
  pin: { date: D, manifestSha256: M, pgSha256: P },
  jobs: {
    restore: { verdict: { ok: true, date: D, pgSha256: P } },
    docs: { verdict: { ok: true, date: D, manifestSha256: M, copyErrors: 0, deleteErrors: 0, mirrorExtra: 0 } },
    recon: { verdict: { ok: true, date: D, manifestSha256: M, missing: 0, sizeMismatch: 0, mirrorExtra: 0 } },
  },
});

test('coherence: database and mirrored documents from one pinned snapshot pass', () => {
  assert.deepEqual(coherence(aligned()), { ok: true, reasons: [] });
});
test('coherence: incident 2026-11-14 (additive copy, preprod receipts left) is refused', () => {
  const r = aligned();
  r.jobs.recon.verdict.mirrorExtra = 3;
  assert.deepEqual(coherence(r), { ok: false, reasons: ['mirror prefixes hold 3 object(s) outside the snapshot'] });
});
test('coherence: a recon verdict without mirror counters (additive tool) is refused', () => {
  const r = aligned();
  delete r.jobs.recon.verdict.mirrorExtra;
  assert.deepEqual(coherence(r).reasons, ['recon did not check the mirror prefixes']);
});
test('coherence: documents and database from different snapshots are refused', () => {
  const r = aligned();
  r.jobs.docs.verdict.date = '2026-11-13';
  r.jobs.restore.verdict.pgSha256 = 'c'.repeat(64);
  assert.deepEqual(coherence(r).reasons, ['database not restored from the pinned snapshot', 'documents not restored from the pinned snapshot']);
});
test('coherence: delete errors, missing documents and no pin are refused', () => {
  const r = aligned();
  r.jobs.docs.verdict.deleteErrors = 1;
  r.jobs.recon.verdict.missing = 2;
  assert.deepEqual(coherence(r).reasons, ['document mirror incomplete', 'snapshot documents missing or different']);
  assert.equal(coherence({ jobs: {} }).ok, false);
});
test('coupled schedules: prepare holds radar-refresh-pv once documents were mirrored', () => {
  assert.deepEqual(coupled({ kind: 'prepare', jobs: { docs: {} } }), { decision: 'hold', hold: ['radar-refresh-pv'] });
  assert.deepEqual(coupled({ kind: 'prepare', jobs: {} }), { decision: 'keep', hold: [] });
});
test('coupled schedules: release after a switch or a coherent daily restore, hold otherwise', () => {
  assert.equal(coupled({ kind: 'cutover', mode: 'run', checkpoints: { switch: 'completed' }, jobs: {} }).decision, 'release');
  assert.equal(coupled({ kind: 'cutover', mode: 'run', checkpoints: { switch: 'rolled-back' }, jobs: {} }).decision, 'keep');
  assert.equal(coupled({ kind: 'cutover', mode: 'restore', coherence: { ok: true }, jobs: { docs: {} } }).decision, 'release');
  assert.deepEqual(coupled({ kind: 'cutover', mode: 'restore', restoreAborted: true, coherence: { ok: true }, jobs: { docs: {} } }),
    { decision: 'hold', hold: ['radar-refresh-pv'] });
  assert.equal(coupled({ kind: 'cutover', mode: 'restore', coherence: { ok: false }, jobs: { docs: {} } }).decision, 'hold');
  assert.equal(coupled({ kind: 'prepare', jobs: { docs: {} } }, 'prod').decision, 'keep');
});

// Controller end-to-end on the synthetic cluster (deploy/cutover/test-boundary.cjs).
import { fixture } from './cutover-fixture.mjs';
const refresh = (f) => f.state().objects.find((o) => o.kind === 'CronJob' && o.metadata.name === 'radar-refresh-pv');
const held = (o) => o.metadata.annotations?.['sentropic.io/held-until-coherent'];

test('daily restore: coherent snapshot passes the gate and leaves radar-refresh-pv active', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('Coherence OK: database and mirrored documents from backup 2026-10-29'), result.stdout);
    assert.equal(refresh(f).spec.suspend, false);
    assert.equal(held(refresh(f)), undefined);
  } finally { f.cleanup(); }
});
test('daily restore: incident state (mirror extras) fails clearly and holds radar-refresh-pv', () => {
  const f = fixture({ mirrorExtra: 3 });
  try {
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('INCOHERENT restore (database vs documents): mirror prefixes hold 3 object(s) outside the snapshot'),
      result.stdout + result.stderr);
    assert.equal(refresh(f).spec.suspend, true);
    assert.match(held(refresh(f)) ?? '', /:false$/);
  } finally { f.cleanup(); }
});
test('prepare holds radar-refresh-pv; the switch to the prepared snapshot releases it', () => {
  const f = fixture();
  try {
    const prepared = f.run('prepare');
    assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
    assert.ok(prepared.stdout.includes('HELD radar-refresh-pv'), prepared.stdout);
    assert.equal(refresh(f).spec.suspend, true);
    const run = f.run('run', ['MODE=run']);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('RELEASED radar-refresh-pv'), run.stdout);
    assert.equal(refresh(f).spec.suspend, false);
    assert.equal(held(refresh(f)), undefined);
  } finally { f.cleanup(); }
});
const preHeld = (f, value) => {
  const state = f.state();
  const cronjob = state.objects.find((o) => o.kind === 'CronJob' && o.metadata.name === 'radar-refresh-pv');
  cronjob.spec.suspend = true;
  cronjob.metadata.annotations = { 'sentropic.io/held-until-coherent': value };
  writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
};
test('daily restore keeps a free-text human hold (never released automatically)', () => {
  const f = fixture();
  const text = 'i-cond 2026-11-15: preprod PG/S3 incoherent, held until #1113 restore';
  try {
    preHeld(f, text);
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('human hold kept, not released'), result.stdout);
    assert.equal(refresh(f).spec.suspend, true);
    assert.equal(held(refresh(f)), text);
  } finally { f.cleanup(); }
});
test('daily restore releases a hold written as <run>:false', () => {
  const f = fixture();
  try {
    preHeld(f, 'i-cond-20261115:false');
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('RELEASED radar-refresh-pv'), result.stdout);
    assert.equal(refresh(f).spec.suspend, false);
    assert.equal(held(refresh(f)), undefined);
  } finally { f.cleanup(); }
});
