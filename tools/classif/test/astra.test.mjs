import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROUTES, seatEnv } from '../run-seat.mjs';

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
    const events = [
      JSON.stringify({ type: 'thread.started', thread_id: 't-1' }),
      'not json, ignored',
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 34 } }),
    ].join('\n');
    // No file: text falls back to the events (no text field here → empty, usage kept).
    assert.deepEqual(r.parse(events, dir), { text: '', usage: { input_tokens: 12, output_tokens: 34 } });
    writeFileSync(path.join(dir, 'last-message.md'), '{"code":"S-PLANIFIE"}\n');
    const parsed = r.parse(events, dir);
    assert.equal(parsed.text, '{"code":"S-PLANIFIE"}');
    assert.deepEqual(parsed.usage, { input_tokens: 12, output_tokens: 34 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
