// GEPA re-review fixes (review-gepa-972, « Re-revue »): seat dir cleanup when the command build
// fails (R3), seat env without any $CLASSIF_HOME reference and codex homes outside it (R4),
// seat auth refresh and authentication hint (R5), S113 item id. Synthetic data, no paid call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { ROUTES, callSeat, codexHomeDir, ensureCodexHome, legacyCodexHomeDir, looksLikeAuthFailure, refreshCodexAuth, seatAuthRefreshCommand, seatEnv, seatHomesRoot } from '../run-seat.mjs';
import { devPrompt } from '../l4/dev.mjs';
import { swapEnv, withTempHome } from './hermetic-helpers.mjs';

const CODEX = ['astra-max', 'sol-6.1-low', 'luna-6-low'];
const seatDirs = (base) => readdirSync(base).filter((n) => n.startsWith('classif-codex-seat-') || n.startsWith('seat-'));

test('review R4: no seat env carries a CLASSIF_* variable or the $CLASSIF_HOME path; codex homes sit outside it', withTempHome(async (home) => {
  const restores = [swapEnv('CLASSIF_SOMETHING', 'x'), swapEnv('LEAKY_PATH', `${home}/l3b/reference-d.jsonl`), swapEnv('KEEP_ME', 'ok')];
  try {
    for (const seat of CODEX) {
      const work = mkdtempSync(path.join(os.tmpdir(), 'rr-work-'));
      try {
        const { env } = ROUTES[seat].build(work, path.join(work, 'p.md'), 'p');
        const full = seatEnv(env);
        assert.ok(!Object.keys(full).some((k) => k.startsWith('CLASSIF_')), `${seat}: CLASSIF_* removed`);
        assert.ok(!JSON.stringify(full).includes(home), `${seat}: no value references CLASSIF_HOME`);
        assert.equal(full.KEEP_ME, 'ok');
        assert.equal(full.CODEX_HOME, codexHomeDir(seat));
        assert.ok(path.relative(home, full.CODEX_HOME).startsWith('..'));
        assert.equal(statSync(full.CODEX_HOME).mode & 0o777, 0o700);
      } finally { rmSync(work, { recursive: true, force: true }); }
    }
    assert.equal(seatHomesRoot(), path.resolve(process.env.CLASSIF_SEAT_HOMES));
    assert.ok(!seatEnv().CLASSIF_HOME && !seatEnv().CLASSIF_TEST_MODE);
    // A seat home inside CLASSIF_HOME is refused.
    assert.throws(() => ensureCodexHome('sol-6.1-low', { model: 'gpt-6.1-sol', effort: 'low', home, root: path.join(home, 'seats') }), /inside CLASSIF_HOME/);
  } finally { while (restores.length) restores.pop()(); }
}));

test('review R4: migration copies the auth of the former home in $CLASSIF_HOME, atomically', withTempHome(async (home) => {
  const legacy = legacyCodexHomeDir('astra-max', home);
  mkdirSync(legacy, { recursive: true });
  writeFileSync(path.join(legacy, 'auth.json'), '{"legacy":"refreshed-token"}');
  const root = mkdtempSync(path.join(os.tmpdir(), 'rr-seats-'));
  try {
    const dir = ensureCodexHome('astra-max', { model: 'gpt-6-astra', effort: 'max', home, root });
    assert.equal(legacy, path.join(home, 'seat-homes', 'astra'));
    assert.equal(readFileSync(path.join(dir, 'auth.json'), 'utf8'), '{"legacy":"refreshed-token"}', 'the former token wins over ~/.codex');
    assert.equal(statSync(path.join(dir, 'auth.json')).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir).sort(), ['auth.json', 'config.toml']);
  } finally { rmSync(root, { recursive: true, force: true }); }
}));

test('review R3: the seat dir is removed when building the command or spawning fails', withTempHome(async (home) => {
  // No auth anywhere: the codex home preparation throws inside build.
  const restores = [swapEnv('CLASSIF_ASTRA_AUTH_SRC', path.join(home, 'absent-auth.json')), swapEnv('CLASSIF_SEAT_HOMES', mkdtempSync(path.join(os.tmpdir(), 'rr-empty-seats-')))];
  const base = os.tmpdir();
  const before = new Set(seatDirs(base));
  try {
    await assert.rejects(async () => callSeat('luna-6-low', 'secret item text', { spawnImpl: () => { throw new Error('never reached'); } }), /isolation refused: no auth to copy/);
    assert.deepEqual(seatDirs(base).filter((n) => !before.has(n)), [], 'no codex seat dir left behind');
  } finally { while (restores.length) restores.pop()(); }
  const own = path.join(home, 'seat-base');
  await assert.rejects(callSeat('opus-5.5-low', 'secret item text', { base: own, spawnImpl: () => { throw new Error('spawn failed'); } }), /spawn failed/);
  assert.deepEqual(readdirSync(own), [], 'no seat dir left behind after a spawn failure');
}));

test('review R5: authentication failures are recognised and the refresh copies ~/.codex/auth.json atomically', withTempHome(async (home) => {
  assert.ok(looksLikeAuthFailure(1, 'ERROR: unexpected status 401 Unauthorized'));
  assert.ok(looksLikeAuthFailure(1, 'Your refresh token has expired, please run codex login'));
  assert.ok(!looksLikeAuthFailure(0, '401'), 'a successful call is never an auth failure');
  assert.ok(!looksLikeAuthFailure(2, 'HTTP 402 budget exhausted'));
  assert.equal(seatAuthRefreshCommand('luna-6-low'), 'make classif-seat-auth-refresh SEAT=luna-6-low ENV=preprod');
  const src = path.join(home, 'new-login.json');
  writeFileSync(src, '{"v":"fresh"}');
  const dir = ensureCodexHome('sol-6.1-low', { model: 'gpt-6.1-sol', effort: 'low', home });
  writeFileSync(path.join(dir, 'auth.json'), '{"v":"stale"}');
  assert.equal(refreshCodexAuth('sol-6.1-low', { home, authSrc: src }), dir);
  assert.equal(readFileSync(path.join(dir, 'auth.json'), 'utf8'), '{"v":"fresh"}');
  assert.deepEqual(readdirSync(dir).sort(), ['auth.json', 'config.toml'], 'no temp file left');
  assert.throws(() => refreshCodexAuth('opus-5.5-low', { home, authSrc: src }), /not a codex seat/);
  assert.throws(() => refreshCodexAuth('sol-6.1-low', { home, authSrc: path.join(home, 'none.json') }), /absent/);
  assert.ok(existsSync(dir));
}));

test('review: S113 prompts carry the evalId as item id, dev prompts are unchanged', () => {
  assert.match(devPrompt('P', { evalId: 'eval-7', input: 'texte' }), /### item_id: eval-7\n/);
  assert.ok(!devPrompt('P', { evalId: 'eval-7', input: 'texte' }).includes('undefined'));
  assert.equal(devPrompt('P ', { itemId: 'it-1', input: 'texte' }), 'P\n\n## Item to classify\n\n### item_id: it-1\n\ntexte\n');
});
