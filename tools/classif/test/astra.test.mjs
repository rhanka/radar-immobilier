import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ASTRA_ISOLATED_CONFIG, CODEX_BENIGN_ITEM_TYPES, CODEX_KNOWN_EVENT_TYPES, ROUTES, astraCodexHomeDir, countCodexToolEvents, ensureAstraHome, seatEnv } from '../run-seat.mjs';

const tmp = () => {
  try { return mkdtempSync(path.join(os.tmpdir(), 'astra-')); }
  catch (e) { if (e?.code !== 'EROFS' && e?.code !== 'EACCES') throw e; return mkdtempSync(path.join('/tmp', 'astra-')); }
};

// Step 0 (plan v3, owner decision 04/11): the astra-max seat route.
test('astra-max route: conductor-verified codex argv, model and effort', () => {
  const r = ROUTES['astra-max'];
  assert.ok(r, 'astra-max route is registered');
  assert.equal(r.family, 'Astra');
  assert.equal(r.model, 'gpt-6-astra');
  assert.equal(r.effort, 'max');
  const dir = tmp();
  try {
    const prompt = 'classify this synthetic item';
    const built = r.build(dir, path.join(dir, 'prompt.md'), prompt);
    assert.equal(built.cmd, 'codex');
    // Conductor-verified core: codex exec -m gpt-6-astra -c model_reasoning_effort=max -s read-only.
    const argv = built.args;
    assert.deepEqual(argv.slice(0, 8),
      ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=max', '-s', 'read-only', '--skip-git-repo-check']);
    // Machine parsing only: JSONL events + last-message file; prompt on stdin (no arg limit).
    assert.ok(argv.includes('--json'), 'codex --json for machine parsing');
    assert.ok(argv.includes('-o'), 'codex -o last-message.md for the final answer');
    assert.ok(argv.includes(path.join(dir, 'last-message.md')), 'last-message.md lands in the seat work dir');
    assert.equal(argv[argv.length - 1], '-', 'prompt delivered on stdin');
    assert.equal(built.stdin, prompt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('astra-max parse: last-message file wins, usage from JSONL events', () => {
  const r = ROUTES['astra-max'];
  const dir = tmp();
  try {
    mkdirSync(dir, { recursive: true });
    // Review §10: fail closed on form — pure-JSON benign streams count 0.
    const events = [
      JSON.stringify({ type: 'thread.started', thread_id: 't-1' }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 34 } }),
    ].join('\n');
    // No file: text falls back to the events (no text field here → empty, usage kept).
    const p0 = r.parse(events, dir);
    assert.equal(p0.text, '');
    assert.deepEqual(p0.usage, { input_tokens: 12, output_tokens: 34 });
    assert.equal(p0.toolEvents, 0);
    writeFileSync(path.join(dir, 'last-message.md'), '{"code":"S-PLANIFIE"}\n');
    const parsed = r.parse(events, dir);
    assert.equal(parsed.text, '{"code":"S-PLANIFIE"}');
    assert.deepEqual(parsed.usage, { input_tokens: 12, output_tokens: 34 });
    assert.equal(parsed.toolEvents, 0);
    // A non-JSON line is not benign: it counts (fail-closed form).
    assert.equal(r.parse(`${events}\nnot json\n`, dir).toolEvents, 1);
    // A top-level error event counts (no longer allow-listed).
    assert.ok(r.parse(`${events}\n${JSON.stringify({ type: 'error', message: 'boom' })}\n`, dir).toolEvents > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('astra isolation: dedicated CODEX_HOME, config with NO mcp_servers, auth copied', () => {
  // Review §12: hermetic — temp CLASSIF_HOME + fake auth source, never the real seat
  // home nor the real ~/.codex/auth.json.
  const home = tmp();
  const fakeAuth = path.join(home, 'fake-auth.json');
  writeFileSync(fakeAuth, '{"fake":"auth-for-tests"}');
  const prevHome = process.env.CLASSIF_HOME;
  const prevSrc = process.env.CLASSIF_ASTRA_AUTH_SRC;
  process.env.CLASSIF_HOME = home;
  process.env.CLASSIF_ASTRA_AUTH_SRC = fakeAuth;
  try {
    const dir = ensureAstraHome(home);
    assert.equal(dir, astraCodexHomeDir(home));
    assert.ok(dir.startsWith(home));
    assert.ok(!dir.startsWith(path.join(os.homedir(), '.local', 'share', 'radar-classif')), 'must not write the real seat home');
    assert.equal(statSync(dir).mode & 0o777 & 0o077, 0, 'seat home mode 700');
    const cfg = readFileSync(`${dir}/config.toml`, 'utf8');
    assert.ok(!/^\s*\[mcp_servers/m.test(cfg), 'isolated config holds NO mcp_servers section');
    assert.ok(!/^\s*\[mcp_servers/m.test(ASTRA_ISOLATED_CONFIG));
    // The seat route points codex at the isolated home (temp CLASSIF_HOME, not the real one).
    const work = tmp();
    try {
      const built = ROUTES['astra-max'].build(work, `${work}/prompt.md`, 'p');
      assert.equal(built.env?.CODEX_HOME, astraCodexHomeDir(home));
      assert.ok(String(built.env.CODEX_HOME).startsWith(home), 'CODEX_HOME must stay in the temp home');
      assert.ok(String(built.env.CODEX_HOME).includes('seat-homes/astra'));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    // Auth: copied from the fake source (mode 600), never the real auth, never committed.
    const dst = path.join(dir, 'auth.json');
    assert.ok(existsSync(dst), 'auth copied to the isolated home');
    assert.equal(statSync(dst).mode & 0o777 & 0o077, 0, 'auth mode 600');
    assert.equal(readFileSync(dst, 'utf8'), '{"fake":"auth-for-tests"}');
  } finally {
    if (prevHome === undefined) delete process.env.CLASSIF_HOME; else process.env.CLASSIF_HOME = prevHome;
    if (prevSrc === undefined) delete process.env.CLASSIF_ASTRA_AUTH_SRC; else process.env.CLASSIF_ASTRA_AUTH_SRC = prevSrc;
    rmSync(home, { recursive: true, force: true });
  }
});

test('astra tool accounting: every tool/command/MCP/web/file event counts, unknown fails closed', () => {
  const benign = [
    JSON.stringify({ type: 'thread.started', thread_id: 't' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello with the word tool inside prose' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'think' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } }),
  ].join('\n');
  assert.equal(countCodexToolEvents(benign).toolEvents, 0, 'benign stream counts 0');
  for (const itype of ['command_execution', 'file_change', 'mcp_tool_call', 'collab_tool_call', 'web_search', 'todo_list', 'plan_update', 'error', 'mystery-future-type']) {
    const s = [JSON.stringify({ type: 'thread.started' }),
      JSON.stringify({ type: 'item.completed', item: { type: itype, text: 'x' } }),
      JSON.stringify({ type: 'turn.completed', usage: {} })].join('\n');
    assert.ok(countCodexToolEvents(s).toolEvents > 0, `${itype} must count`);
  }
  // Unknown top-level event type fails closed.
  const unknownTop = [JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'wormhole.opened', item: { type: 'agent_message', text: 'x' } })].join('\n');
  const u = countCodexToolEvents(unknownTop);
  assert.ok(u.toolEvents > 0 && u.unknownTypes.includes('wormhole.opened'));
  // Missing type fails closed.
  assert.ok(countCodexToolEvents(`${JSON.stringify({ no: 'type' })}\n`).toolEvents > 0);
  // Missing item type fails closed.
  assert.ok(countCodexToolEvents(`${JSON.stringify({ type: 'item.completed', item: {} })}\n`).toolEvents > 0);
  // parseCodex surfaces the count (the run.mjs fail-closed gate reads it).
  const dir = tmp();
  try {
    mkdirSync(dir, { recursive: true });
    const toolStream = [JSON.stringify({ type: 'thread.started' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'datagouv', tool: 'search' } }),
      JSON.stringify({ type: 'turn.completed', usage: {} })].join('\n');
    assert.ok(ROUTES['astra-max'].parse(toolStream, dir).toolEvents > 0, 'parse must report toolEvents>0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(CODEX_KNOWN_EVENT_TYPES.has('turn.completed'));
  assert.ok(CODEX_BENIGN_ITEM_TYPES.has('agent_message') && !CODEX_BENIGN_ITEM_TYPES.has('mcp_tool_call'));
});

test('seat env stays scrubbed for the astra seat (provider keys, eval keys)', () => {
  // seatEnv scrubs process.env; explicit extra overrides (e.g. VIBE_ACTIVE_MODEL) pass through.
  const saved = {};
  for (const k of ['OPENAI_API_KEY', 'MISTRAL_API_KEY', 'REFERENCE_C_KEY', 'CLASSIF_EVAL_KEY', 'CLASSIF_BLIND_KEY']) {
    saved[k] = process.env[k];
    process.env[k] = `secret-${k}`;
  }
  try {
    const env = seatEnv({ HOME: '/home/u' });
    for (const k of Object.keys(saved)) assert.ok(!(k in env), `${k} must not reach the seat`);
    assert.equal(env.HOME, '/home/u');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
