// L4 optimise seat override (owner decision 06/11, recorded method deviation): hermetic.
// Fake in-process seats only (no paid call), temp repo via CLASSIF_REPO in test mode. The
// astra-max seat path (real callSeat + codex route) is covered in l4-optimise-astra.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MAX_SEATS, OPTIMISERS, OWNER_DEVIATION_0611, RECONCILER, buildObjective, buildOptimiserPrompt, buildReconciliationPrompt, main, resolveSeats } from '../l4/optimise.mjs';
import { ROUTES } from '../run-seat.mjs';
import { REPO_ROOT, tmp, withTempHome } from './hermetic-helpers.mjs';
import { CLEAN1, DIRTY, K, MATERIALS_SENT, OVERRIDE, callsLog, fakeSeat, manifestFile, setup } from './l4-optimise-fixture.mjs';
import process from 'node:process';

test('override: the known max seats are the run-seat.mjs max routes; defaults unchanged', () => {
  assert.deepEqual([...MAX_SEATS].sort(), ['astra-max', 'muse-wonder-max', 'opus-5.5-max']);
  for (const s of MAX_SEATS) assert.equal(ROUTES[s].effort, 'max');
  assert.deepEqual(OPTIMISERS, ['muse-wonder-max', 'opus-5.5-max']);
  assert.equal(RECONCILER, 'muse-wonder-max');
  assert.deepEqual(resolveSeats(), { optimisers: OPTIMISERS, reconciler: RECONCILER, deviation: null });
  assert.deepEqual(resolveSeats({ optimisers: 'muse-wonder-max,opus-5.5-max', reconciler: 'muse-wonder-max' }).deviation, null);
  // Default reconciliation prompt stays byte-identical (cache sha of a default run unchanged).
  assert.equal(buildReconciliationPrompt(['a', 'b']), buildReconciliationPrompt(['a', 'b'], ['muse-wonder-max', 'opus-5.5-max']));
});

test('override: invalid seats, duplicated pairs, wrong arity and an unexplained deviation are refused', () => {
  assert.throws(() => resolveSeats({ optimisers: 'astra-max,gpt-9' }), /unknown seat gpt-9/);
  assert.throws(() => resolveSeats({ optimisers: 'astra-max,opus-5.5-low' }), /unknown seat opus-5.5-low/);
  assert.throws(() => resolveSeats({ reconciler: 'muse-spark-1.3-low' }), /unknown seat muse-spark-1.3-low/);
  assert.throws(() => resolveSeats({ optimisers: 'astra-max,astra-max' }), /duplicated optimiser pair/);
  assert.throws(() => resolveSeats({ optimisers: 'astra-max' }), /exactly 2 seats/);
  assert.throws(() => resolveSeats({ optimisers: 'astra-max,opus-5.5-max,muse-wonder-max' }), /exactly 2 seats/);
  // Non-default and not the recorded owner decision: a reason is required.
  assert.throws(() => resolveSeats({ optimisers: 'astra-max,muse-wonder-max' }), /needs DEVIATION/);
  assert.equal(resolveSeats({ optimisers: 'astra-max,muse-wonder-max', deviation: 'test reason' }).deviation, 'test reason');
  assert.equal(resolveSeats({ optimisers: 'astra-max,opus-5.5-max', reconciler: 'opus-5.5-max' }).deviation, OWNER_DEVIATION_0611.text);
});

test('override: an invalid seat in main() refuses before any seat call or budget record', withTempHome(async (home) => {
  setup(home);
  const f = fakeSeat();
  await assert.rejects(main(['--series', K, '--optimisers', 'astra-max,nope-max'], { seat: f.seat }), /unknown seat nope-max/);
  await assert.rejects(main(['--series', K, '--optimisers', 'opus-5.5-max,opus-5.5-max'], { seat: f.seat }), /duplicated optimiser pair/);
  assert.equal(f.seen.length, 0);
  assert.ok(!existsSync(callsLog(home)));
}));

test('override: astra-max + opus-5.5-max optimise, opus-5.5-max reconciles, all recorded', withTempHome(async (home) => {
  const repo = setup(home);
  const f = fakeSeat();
  const m = await main(['--series', K, ...OVERRIDE], { seat: f.seat });
  assert.deepEqual(f.byKind('opt').map((s) => s.annotator), ['astra-max', 'opus-5.5-max']);
  assert.deepEqual(f.byKind('rec').map((s) => s.annotator), ['opus-5.5-max']);
  // Firewall unchanged: every optimiser seat gets exactly the buildOptimiserPrompt output.
  for (const s of f.byKind('opt')) assert.equal(s.prompt, buildOptimiserPrompt(MATERIALS_SENT));
  assert.match(f.byKind('rec')[0].prompt, /## Candidate A \(astra-max\)/);
  assert.match(f.byKind('rec')[0].prompt, /## Candidate B \(opus-5\.5-max\)/);
  const disk = JSON.parse(readFileSync(manifestFile(repo), 'utf8'));
  for (const man of [m, disk]) {
    assert.deepEqual(man.optimisers, ['astra-max', 'opus-5.5-max']);
    assert.equal(man.reconciler, 'opus-5.5-max');
    assert.equal(man.deviation, 'owner 06/11: Muse weekly quota exhausted until 08/11 — Astra max replaces Muse Wonder max as optimiser; Opus 5.5 max reconciles');
  }
  const phases = readFileSync(callsLog(home), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.intent);
  assert.deepEqual(phases.map((r) => `${r.phase}:${r.annotator}`), [`l4-opt-s${K}:astra-max`, `l4-opt-s${K}:opus-5.5-max`, `l4-opt-s${K}-reconcile:opus-5.5-max`]);
}));

test('override: the defaults are unchanged (muse-wonder-max + opus-5.5-max, muse-wonder-max reconciles, no deviation)', withTempHome(async (home) => {
  const repo = setup(home);
  const f = fakeSeat();
  const m = await main(['--series', K], { seat: f.seat });
  assert.deepEqual(f.byKind('opt').map((s) => s.annotator), ['muse-wonder-max', 'opus-5.5-max']);
  assert.deepEqual(f.byKind('rec').map((s) => s.annotator), ['muse-wonder-max']);
  assert.equal(f.byKind('rec')[0].prompt, buildReconciliationPrompt([CLEAN1, CLEAN1], OPTIMISERS, buildObjective(MATERIALS_SENT)));
  const disk = JSON.parse(readFileSync(manifestFile(repo), 'utf8'));
  for (const man of [m, disk]) {
    assert.deepEqual(man.optimisers, ['muse-wonder-max', 'opus-5.5-max']);
    assert.equal(man.reconciler, 'muse-wonder-max');
    assert.ok(!('deviation' in man));
  }
}));

test('override: the repair pass uses the reconciler override', withTempHome(async (home) => {
  setup(home);
  const f = fakeSeat({ reconcile: DIRTY });
  const m = await main(['--series', K, ...OVERRIDE], { seat: f.seat });
  assert.equal(m.repairs, 1);
  assert.deepEqual(f.byKind('repair').map((s) => s.annotator), ['opus-5.5-max']);
  assert.ok(!f.seen.some((s) => s.annotator === 'muse-wonder-max'), 'no muse call under the override');
  assert.ok(readdirSync(path.join(home, 'l4', 'opt-raw')).some((n) => n.startsWith(`l4-opt-s${K}-repair1.opus-5.5-max.`)));
}));

test('classif.mk wires OPTIMISERS / RECONCILER / DEVIATION to classif-l4-optimise', () => {
  const dry = (vars) => spawnSync('make', ['-s', '-n', '-f', 'tools/classif/classif.mk', 'classif-l4-optimise', 'SERIES=2', ...vars, 'ENV=preprod'],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CLASSIF_HOME: tmp('mk-home-') } });
  const over = dry(['OPTIMISERS=astra-max,opus-5.5-max', 'RECONCILER=opus-5.5-max']);
  assert.equal(over.status, 0, over.stderr);
  assert.match(over.stdout, /l4\/optimise\.mjs --series 2 +--optimisers astra-max,opus-5\.5-max --reconciler opus-5\.5-max/);
  assert.ok(!over.stdout.includes('--deviation'));
  const reason = dry(['OPTIMISERS=astra-max,muse-wonder-max', 'DEVIATION=test reason']);
  assert.match(reason.stdout, /--deviation 'test reason'/);
  const def = dry([]);
  assert.equal(def.status, 0, def.stderr);
  assert.ok(!/--optimisers|--reconciler|--deviation/.test(def.stdout), 'defaults pass no override flag');
});
