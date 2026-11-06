// GEPA review fixes (review-gepa-972): tool events fail closed, codex seat cwd outside
// $CLASSIF_HOME, codex tool features off, codex home prepared once, final selection over every
// eligible candidate, failure classes, resolved-only failure share. Synthetic data, no paid call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { CODEX_DISABLED_FEATURES, ROUTES, callSeat, codexHomeDir, codexSeatBase, ensureCodexHome } from '../run-seat.mjs';
import { parseSeatResult } from '../l4/dev.mjs';
import { gepaBlindRouteGate } from '../l4/blind.mjs';
import { finalSelection, trailingSkipped } from '../l4/gepa.mjs';
import { loadCodes } from '../l2/run.mjs';
import { swapEnv, withTempHome } from './hermetic-helpers.mjs';

const CODES = loadCodes();

test('review B1a: any tool event or non-zero exit is an infra failure; an invalid answer is an answer failure', () => {
  const ok = JSON.stringify({ verdict: 'pertinent', code: 'P-DENSITE' });
  assert.deepEqual(parseSeatResult({ code: 0, text: ok, toolEvents: 0 }, CODES), { verdict: 'pertinent', code: 'P-DENSITE', failed: false, why: null, infra: false });
  assert.deepEqual(parseSeatResult({ code: 0, text: ok, toolEvents: 2 }, CODES), { verdict: null, code: null, failed: true, why: 'tool-events', infra: true },
    'a well-formed answer produced with a tool call is refused');
  assert.equal(parseSeatResult({ code: 3, text: ok }, CODES).why, 'exit-3');
  assert.equal(parseSeatResult({ code: null, text: '', timedOut: true }, CODES).infra, true, 'a timeout is infra');
  for (const [text, why] of [['pas de json', 'no-json'], [JSON.stringify({ verdict: 'pertinent', code: 'X-NOPE' }), 'unknown-code'],
    [JSON.stringify({ verdict: 'non_pertinent', code: 'P-DENSITE' }), 'verdict-not-partition']]) {
    assert.deepEqual([parseSeatResult({ code: 0, text }, CODES).why, parseSeatResult({ code: 0, text }, CODES).infra, parseSeatResult({ code: 0, text }, CODES).failed], [why, false, true]);
  }
});

/** Minimal spawn stand-in: records cwd, emits a codex stream, writes last-message.md, closes. */
function fakeSpawn(seen) {
  return (cmd, args, opts) => {
    seen.push({ cmd, args, cwd: opts.cwd, cwdEntries: readdirSync(opts.cwd) });
    const child = new EventEmitter();
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { on() {}, end() {
      writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ verdict: 'pertinent', code: 'P-DENSITE' }));
      setImmediate(() => {
        child.stdout.emit('data', '{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"command_execution","command":"cat x"}}\n');
        child.emit('close', 0);
      });
    } };
    child.kill = () => {};
    return child;
  };
}

test('review B1b: a codex seat runs in an empty per-call dir outside $CLASSIF_HOME, removed afterwards', withTempHome(async (home) => {
  const seen = [];
  const insideHome = path.join(home, 'l4', 'seat-tmp');
  const r = await callSeat('sol-6.1-low', 'prompt', { base: insideHome, spawnImpl: fakeSpawn(seen) });
  assert.equal(seen.length, 1);
  const rel = path.relative(home, seen[0].cwd);
  assert.ok(rel.startsWith('..'), `cwd ${seen[0].cwd} must be outside CLASSIF_HOME ${home}`);
  assert.deepEqual(seen[0].cwdEntries, [], 'empty cwd at start');
  assert.ok(!existsSync(seen[0].cwd), 'per-call dir removed after the call');
  assert.ok(r.toolEvents > 0, 'the command event is reported to the caller');
  assert.ok(parseSeatResult(r, CODES).infra);
  // A non-codex seat keeps the caller's base.
  const restore = swapEnv('TMPDIR', path.join(home, 'tmp-inside'));
  try {
    assert.throws(() => codexSeatBase(), /codex seat refused: temp dir .* is inside CLASSIF_HOME/);
    await assert.rejects(async () => callSeat('luna-6-low', 'p', { spawnImpl: fakeSpawn([]) }), /inside CLASSIF_HOME/);
  } finally { restore(); }
}));

test('review B1c: every isolated codex config switches the tool features off', withTempHome(async (home) => {
  for (const seat of ['astra-max', 'sol-6.1-low', 'luna-6-low']) {
    const r = ROUTES[seat];
    const dir = ensureCodexHome(seat, { model: r.model, effort: r.effort, home });
    const cfg = readFileSync(path.join(dir, 'config.toml'), 'utf8');
    assert.match(cfg, /^\[features\]$/m);
    for (const f of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'view_image', 'browser_use', 'computer_use']) {
      assert.ok(CODEX_DISABLED_FEATURES.includes(f));
      assert.match(cfg, new RegExp(`^${f} = false$`, 'm'), `${seat}: ${f}`);
    }
    assert.ok(!/^\s*\[mcp_servers/m.test(cfg));
    assert.match(cfg, /web_search = "disabled"/);
  }
}));

test('review M2: a codex home is prepared once per process, atomically, auth never recopied during the run', withTempHome(async (home) => {
  const src = path.join(home, 'auth-src.json');
  writeFileSync(src, '{"v":1}');
  const dir = ensureCodexHome('luna-6-low', { model: 'gpt-6-luna', effort: 'low', home, authSrc: src });
  assert.equal(dir, codexHomeDir('luna-6-low'));
  assert.equal(readFileSync(path.join(dir, 'auth.json'), 'utf8'), '{"v":1}');
  // The seat refreshes its token, the source changes, the config is touched: a second call of the
  // same process rewrites nothing.
  writeFileSync(path.join(dir, 'auth.json'), '{"v":"refreshed-by-codex"}');
  writeFileSync(src, '{"v":2}');
  writeFileSync(path.join(dir, 'config.toml'), 'sentinel');
  assert.equal(ensureCodexHome('luna-6-low', { model: 'gpt-6-luna', effort: 'low', home, authSrc: src }), dir);
  for (let i = 0; i < 3; i++) ROUTES['luna-6-low'].build(home, path.join(home, 'p.md'), 'p');
  assert.equal(readFileSync(path.join(dir, 'auth.json'), 'utf8'), '{"v":"refreshed-by-codex"}');
  assert.equal(readFileSync(path.join(dir, 'config.toml'), 'utf8'), 'sentinel');
  assert.deepEqual(readdirSync(dir).sort(), ['auth.json', 'config.toml'], 'no temp file left behind');
  assert.equal(process.env.CLASSIF_TEST_MODE, '1');
}));

const E = (id, misses, noise) => ({ base: { id }, pareto: { misses, noise, failures: 0, cases: 4 } });
const perRoute = (failures = 0) => ({ r1: { misses: 0, noise: 0, failures, items: 10 } });

test('review M1: the final evaluates every candidate without a D_pareto miss, not a top 3', async () => {
  const ranked = [E('a', 0, 0), E('b', 0, 1), E('c', 0, 2), E('d', 0, 3), E('x', 1, 0)];
  const totals = { a: { misses: 1, noise: 0 }, b: { misses: 2, noise: 0 }, c: { misses: 1, noise: 1 }, d: { misses: 0, noise: 7 } };
  const evaluated = [];
  const r = await finalSelection(ranked, { fits: () => true, cost: () => 10,
    evaluate: async (e) => { evaluated.push(e.base.id); return { total: { ...totals[e.base.id], failures: 0 }, perRoute: perRoute() }; } });
  assert.deepEqual(evaluated, ['a', 'b', 'c', 'd'], 'the 4th eligible candidate is evaluated');
  assert.equal(r.winner.id, 'd');
  assert.deepEqual(r.coverage, { eligible: 4, evaluated: 4, notEvaluated: 0 });
  assert.equal(r.finalists.find((f) => f.id === 'x').status, 'excluded');
});

test('review M1: a budget cut is counted, a later cheaper candidate is still tried', async () => {
  const ranked = [E('a', 0, 0), E('b', 0, 1), E('c', 0, 2)];
  const r = await finalSelection(ranked, { fits: (n) => n <= 5, cost: (e) => (e.base.id === 'b' ? 50 : 0),
    evaluate: async (e) => ({ total: { misses: e.base.id === 'a' ? 1 : 0, noise: 2, failures: 0 }, perRoute: perRoute() }) });
  assert.deepEqual(r.finalists.map((f) => [f.id, f.status]), [['a', 'evaluated'], ['b', 'not-evaluated'], ['c', 'evaluated']]);
  assert.deepEqual(r.coverage, { eligible: 3, evaluated: 2, notEvaluated: 1 });
  assert.equal(r.winner.id, 'c');
});

test('review: a 0-miss finalist over the 5 % failed-call share on a route is not retained', async () => {
  const r = await finalSelection([E('a', 0, 0), E('b', 0, 5)], { fits: () => true, cost: () => 0,
    evaluate: async (e) => ({ total: { misses: 0, noise: e.base.id === 'a' ? 0 : 5, failures: 0 }, perRoute: perRoute(e.base.id === 'a' ? 1 : 0) }) });
  assert.deepEqual(r.finalists[0].failureCeilingExceeded, ['r1']);
  assert.equal(r.winner.id, 'b');
});

test('review m1/m5: consecutive skipped count; GEPA failure share over resolved cases only', () => {
  const j = (statuses) => statuses.map((status, iter) => ({ iter, status }));
  assert.equal(trailingSkipped(j(['admitted', 'skipped', 'skipped'])), 2);
  assert.equal(trailingSkipped(j(['skipped', 'rejected'])), 0);
  assert.equal(trailingSkipped([]), 0);
  // 20 resolved + 20 unresolved blind rows, 1 failure on a resolved row: 1/20 = 5 % (pass), not 1/40.
  const blind = Array.from({ length: 40 }, (_, i) => ({ itemId: `b${i}`, verdict: 'pertinent', status: i < 20 ? 'resolved' : 'unresolved' }));
  const rows = blind.map((_, i) => ({ failed: i === 0 || i >= 38, pred: i === 0 || i >= 38 ? null : { verdict: 'pertinent' } }));
  assert.deepEqual(gepaBlindRouteGate(blind, rows, 0.05), { verdict: 'pass', misses: 0, failureShare: 0.05 });
  rows[1] = { failed: true, pred: null };
  assert.equal(gepaBlindRouteGate(blind, rows, 0.05).verdict, 'fail', '2/20 resolved failures exceed the ceiling');
});
