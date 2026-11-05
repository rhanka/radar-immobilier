// Integration tests with a fake seat (review §12): cover §1, §2, §4, §5 and §8.
// No paid model call: seats are faked via callSeat's spawnImpl, guards fail before any spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callSeat } from '../run-seat.mjs';
import { buildBlindManifest } from '../l4/blind.mjs';
import { blindDir } from '../lib/blind.mjs';
import { readDevItemCache } from '../l4/dev.mjs';
import { loadGoldenPack } from '../l2/golden-pack.mjs';
import { main as amendMain } from '../l2/amend.mjs';
import { BUDGET_CAP, check as budgetCheck, spent, spentByPhase } from '../lib/budget.mjs';

const tmp = (prefix = 'v3int-') => {
  try { return mkdtempSync(path.join(os.tmpdir(), prefix)); }
  catch (e) { if (e?.code !== 'EROFS' && e?.code !== 'EACCES') throw e; return mkdtempSync(path.join('/tmp', prefix)); }
};

/** Fake seat child: emits stdout then closes, optionally writing last-message.md. */
function fakeSpawnImpl({ stdout = '', exitCode = 0, lastMessage = null } = {}) {
  return (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 424242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {}, on: () => {} };
    child.kill = () => {};
    process.nextTick(() => {
      try {
        if (lastMessage !== null) writeFileSync(path.join(opts.cwd, 'last-message.md'), lastMessage);
        if (stdout) child.stdout.emit('data', stdout);
        child.emit('close', exitCode);
      } catch { child.emit('close', 1); }
    });
    return child;
  };
}

const benignAstraStream = [
  JSON.stringify({ type: 'thread.started', thread_id: 't' }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"code":"S-A"}' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
].join('\n');

const toolAstraStream = [
  JSON.stringify({ type: 'thread.started', thread_id: 't' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'x', tool: 'search' } }),
  JSON.stringify({ type: 'turn.completed', usage: {} }),
].join('\n');

// Fake seat (§10 mechanics used by every integration below): benign astra stream yields a
// vote with toolEvents 0 and the raw --json stream kept; a tool stream fails closed.
test('integration §5/§10: fake astra seat keeps the event stream and counts tools', async () => {
  const base = tmp();
  try {
    const ok = await callSeat('astra-max', 'prompt', { base, timeoutMs: 30000,
      spawnImpl: fakeSpawnImpl({ stdout: benignAstraStream, lastMessage: '{"code":"S-A"}\n' }) });
    assert.equal(ok.code, 0);
    assert.equal(ok.toolEvents, 0);
    assert.equal(ok.rawJsonl, benignAstraStream);
    assert.equal(ok.text, '{"code":"S-A"}');
    const bad = await callSeat('astra-max', 'prompt', { base, timeoutMs: 30000,
      spawnImpl: fakeSpawnImpl({ stdout: toolAstraStream }) });
    assert.ok(bad.toolEvents > 0, 'tool event must count');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// §1: blind aggregates never reach the repo manifest or stdout (D3 adaptation ban).
test('integration §1: blind repo manifest carries no scores', () => {
  assert.ok(blindDir('/h').endsWith(`${path.sep}blind`), 'blindDir must be $HOME/blind');
  const m = buildBlindManifest({ k: '0', promptSha: 'a'.repeat(64), routes: ['r1'], blindItems: 252, aggregatesSha256: 'b'.repeat(64) });
  const blob = JSON.stringify(m);
  for (const bad of ['perRoute', 's113', '"stats"', 'recall', '"failures"']) assert.ok(!blob.includes(bad), `repo manifest must not contain ${bad}`);
  assert.equal(m.aggregatesSha256, 'b'.repeat(64));
  assert.deepEqual(Object.keys(m).sort(), ['aggregatesSha256', 'blindItems', 'createdAt', 'kind', 'note', 'promptSha256', 'routes', 'series'].sort());
});

// §2: cross-review needs the shared golden pack, fail closed before pass 2.
test('integration §2: golden pack loader fails closed when absent', () => {
  const home = tmp();
  try {
    assert.throws(() => loadGoldenPack(home), /golden pack absent/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// §4: amendments come from the tuning half only.
test('integration §4: amend refuses any half but tuning', async () => {
  await assert.rejects(amendMain(['--from', 'G0', '--to', 'G9', '--pass', '2', '--half', 'blind']), /half must be 'tuning'/);
  await assert.rejects(amendMain(['--from', 'G0', '--to', 'G9', '--pass', '2', '--half', 'whatever']), /half must be 'tuning'/);
});

// §5: strict spend, intent-before-call accounting, 3× pre-call control.
test('integration §5: budget is strict and intent-counted', () => {
  const home = tmp();
  try {
    mkdirSync(path.join(home, 'l2'), { recursive: true });
    writeFileSync(path.join(home, 'l2', 'calls.jsonl'), '{"phase":"a"}\nnot-json\n');
    assert.throws(() => spent(home), /corrupt calls log/);
    assert.throws(() => spentByPhase(home), /corrupt calls log/);
    assert.throws(() => budgetCheck(home, 1), /corrupt calls log/);
    writeFileSync(path.join(home, 'l2', 'calls.jsonl'), '{"phase":"a"}\n{"phase":"b"}\n');
    assert.equal(spent(home), 2);
    // Intent + result count once (the intent), never twice, never zero.
    writeFileSync(path.join(home, 'l2', 'calls.jsonl'),
      '{"intent":true,"phase":"p"}\n{"intent":false,"phase":"p"}\n');
    assert.equal(spent(home), 1);
    assert.deepEqual(spentByPhase(home), { p: 1 });
    assert.throws(() => budgetCheck(home, BUDGET_CAP), /pilot budget refused/);
    assert.equal(budgetCheck(home, BUDGET_CAP - 1).remaining, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// §8: L4 per-item resume verifies the (series,promptSha,route,itemId) key.
test('integration §8: dev item cache verifies its key', () => {
  const dir = tmp();
  try {
    const row = { itemId: 'i1', failed: false };
    writeFileSync(path.join(dir, 'dev-r.i1.json'), JSON.stringify({ series: '0', promptSha256: 'p', route: 'r', itemId: 'i1', row }));
    assert.deepEqual(readDevItemCache(dir, 'r', 'i1', '0', 'p'), row);
    assert.equal(readDevItemCache(dir, 'r', 'i1', '0', 'other-sha'), null, 'stale prompt sha must re-run');
    assert.equal(readDevItemCache(dir, 'r', 'i1', '1', 'p'), null, 'other series must re-run');
    assert.equal(readDevItemCache(dir, 'r', 'missing', '0', 'p'), null);
    writeFileSync(path.join(dir, 'dev-r.i2.json'), 'truncated{');
    assert.equal(readDevItemCache(dir, 'r', 'i2', '0', 'p'), null, 'corrupt cache must re-run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
