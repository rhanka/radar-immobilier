// L4 optimise seat override, astra-max path: the seat goes through the REAL callSeat + astra
// route (isolated CODEX_HOME, empty cwd, prompt on stdin, parseCodex) with a fake `codex`
// child injected via spawnImpl. Hermetic: no paid call, temp repo and temp CLASSIF_HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildOptimiserPrompt, main } from '../l4/optimise.mjs';
import { astraCodexHomeDir, callSeat } from '../run-seat.mjs';
import { sha256 } from '../lib/render.mjs';
import { withTempHome } from './hermetic-helpers.mjs';
import { CLEAN1, K, MATERIALS, OVERRIDE, fakeSeat, manifestFile, setup } from './l4-optimise-fixture.mjs';

// Fake `codex` child: reads the prompt on stdin, records it, writes -o last-message.md and a
// --json event stream (reasoning item first, optional tool event, then the agent message).
const FAKE_CODEX = `import fs from 'node:fs';
const args = process.argv.slice(2);
const out = args[args.indexOf('-o') + 1];
let inp = '';
process.stdin.on('data', (d) => { inp += d; });
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.FAKE_CODEX_SEEN, inp);
  const body = fs.readFileSync(process.env.FAKE_CODEX_BODY, 'utf8');
  const ev = [{ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'reasoning', text: 'internal reasoning summary that is not the answer' } }];
  if (process.env.FAKE_CODEX_TOOL === '1') ev.push({ type: 'item.completed', item: { type: 'command_execution', command: 'ls' } });
  ev.push({ type: 'item.completed', item: { type: 'agent_message', text: body } });
  ev.push({ type: 'turn.completed', usage: { input_tokens: inp.length, output_tokens: body.length } });
  if (process.env.FAKE_CODEX_NO_FILE !== '1') fs.writeFileSync(out, body);
  process.stdout.write(ev.map((e) => JSON.stringify(e)).join('\\n') + '\\n');
});
`;

/** astra-max through the real callSeat + route, child replaced by the fake codex; others in-process. */
function astraViaFakeCodex(home, { body, tool = false, noFile = false }) {
  const bin = path.join(home, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'codex.mjs'), FAKE_CODEX);
  writeFileSync(path.join(bin, 'body.txt'), body);
  const spawns = [];
  const fake = fakeSeat();
  const seat = async (annotator, prompt, opts) => {
    if (annotator !== 'astra-max') return fake.seat(annotator, prompt);
    const seen = path.join(bin, `seen-${spawns.length}.txt`);
    const spawnImpl = (cmd, args, o) => {
      spawns.push({ cmd, args, cwd: o.cwd, codexHome: o.env.CODEX_HOME, workEntries: readdirSync(o.cwd), seen });
      return spawn(process.execPath, [path.join(bin, 'codex.mjs'), ...args], { ...o, env: { ...o.env,
        FAKE_CODEX_SEEN: seen, FAKE_CODEX_BODY: path.join(bin, 'body.txt'), FAKE_CODEX_TOOL: tool ? '1' : '0', FAKE_CODEX_NO_FILE: noFile ? '1' : '0' } });
    };
    return callSeat(annotator, prompt, { ...opts, spawnImpl });
  };
  return { seat, spawns, fake };
}

const LONG = Array.from({ length: 600 }, (_, i) => `${CLEAN1} General rule number ${i} keeps the answer schema.`).join('\n');

test('override astra seat: optimiser prompt on stdin of the isolated codex route, very long answer kept whole', withTempHome(async (home) => {
  const repo = setup(home);
  assert.ok(LONG.length > 100000);
  const a = astraViaFakeCodex(home, { body: LONG });
  const m = await main(['--series', K, ...OVERRIDE], { seat: a.seat });
  assert.equal(a.spawns.length, 1);
  const s = a.spawns[0];
  assert.equal(s.cmd, 'codex');
  assert.deepEqual(s.args.slice(0, 7), ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=max', '-s', 'read-only']);
  assert.equal(s.args[s.args.length - 1], '-');
  assert.deepEqual(s.workEntries, [], 'empty cwd');
  assert.equal(s.codexHome, astraCodexHomeDir(home), 'isolated CODEX_HOME');
  assert.equal(readFileSync(s.seen, 'utf8'), buildOptimiserPrompt(MATERIALS), 'same firewall prompt, delivered on stdin');
  assert.equal(m.proposalSha256[0], sha256(LONG.trim()), 'very long proposal kept whole');
  assert.ok(a.fake.byKind('rec')[0].prompt.includes(LONG.trim()));
  assert.ok(existsSync(manifestFile(repo)));
}));

test('override astra seat: a JSON-wrapped {"prompt": ...} answer is unwrapped', withTempHome(async (home) => {
  setup(home);
  const wrapped = astraViaFakeCodex(home, { body: JSON.stringify({ prompt: LONG }) });
  const m = await main(['--series', K, ...OVERRIDE], { seat: wrapped.seat });
  assert.equal(m.proposalSha256[0], sha256(LONG.trim()));
}));

test('override astra seat: a JSON-only answer fails closed', withTempHome(async (home) => {
  const repo = setup(home);
  const jsonOnly = JSON.stringify({ rules: Array.from({ length: 30 }, (_, i) => `rule ${i} in general words`) });
  const j = astraViaFakeCodex(home, { body: jsonOnly });
  await assert.rejects(main(['--series', K, ...OVERRIDE], { seat: j.seat }), /optimiser astra-max returned no usable prompt \(too short or JSON-only\)/);
  assert.ok(!existsSync(manifestFile(repo)));
}));

test('override astra seat: a tool-event stream fails closed and is not cached', withTempHome(async (home) => {
  setup(home);
  const t = astraViaFakeCodex(home, { body: LONG, tool: true });
  await assert.rejects(main(['--series', K, ...OVERRIDE], { seat: t.seat }), /astra-max answer refused: 1 tool event/);
  // Not cached: a clean re-run pays the astra call again and succeeds.
  const ok = astraViaFakeCodex(home, { body: LONG });
  const m = await main(['--series', K, ...OVERRIDE], { seat: ok.seat });
  assert.equal(ok.spawns.length, 1);
  assert.equal(m.proposalSha256[0], sha256(LONG.trim()));
}));

test('astra parse: without last-message.md the agent message wins over a reasoning item', withTempHome(async (home) => {
  setup(home);
  const a = astraViaFakeCodex(home, { body: LONG, noFile: true });
  const m = await main(['--series', K, ...OVERRIDE], { seat: a.seat });
  assert.equal(m.proposalSha256[0], sha256(LONG.trim()));
}));

