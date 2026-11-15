import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

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
