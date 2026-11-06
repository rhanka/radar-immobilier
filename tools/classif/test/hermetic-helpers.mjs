// Shared hermetic-test helpers (review D2): temp homes in test mode, temp git
// repos, fake seat-auth and vibe configs. These helpers never write to the real
// checkout: repo manifests (split, series, amend, reference-d, blind) always land
// in a temp repo selected via CLASSIF_REPO + CLASSIF_TEST_MODE=1, which the
// production paths honour only in test mode (lib/paths.mjs testOnlyEnv gate).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../lib/render.mjs';
import { URL } from 'node:url';
import process from 'node:process';

export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
export const CLASSIF_DIR = path.join(REPO_ROOT, 'tools', 'classif');

export const tmp = (prefix = 'hermetic-') => {
  try { return mkdtempSync(path.join(os.tmpdir(), prefix)); }
  catch (e) { if (e?.code !== 'EROFS' && e?.code !== 'EACCES') throw e; return mkdtempSync(path.join('/tmp', prefix)); }
};

export function saveEnv(keys) {
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  return saved;
}

export function restoreEnv(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

/** Temporarily sets one env var, returns a restore function. */
export function swapEnv(key, value) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  return () => {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
  };
}

/**
 * Runs fn with a temp CLASSIF_HOME in test mode: CLASSIF_TEST_MODE=1 plus fake
 * seat-auth and vibe configs, so ensureAstraHome/vibeHome never read the real
 * ~/.codex/auth.json or ~/.vibe/config.toml. Restores the env and removes home.
 */
export function withTempHome(fn) {
  return async () => {
    const home = tmp('hermetic-home-');
    const saved = saveEnv(['CLASSIF_HOME', 'CLASSIF_TEST_MODE', 'CLASSIF_SPLIT_FILE', 'CLASSIF_REPO',
      'CLASSIF_EVAL_DIR', 'CLASSIF_TEST_QUOTA_WAIT_MS', 'CLASSIF_ROLE', 'CLASSIF_BLIND_KEY',
      'CLASSIF_ACTOR', 'CLASSIF_ASTRA_AUTH_SRC', 'CLASSIF_VIBE_CONFIG_SRC', 'CLASSIF_EVAL_KEY', 'CLASSIF_SEAT_HOMES']);
    // Codex seat homes live OUTSIDE CLASSIF_HOME (review GEPA R4): a sibling temp dir, never the
    // real ~/.local/share/radar-classif-seats.
    const seatHomes = tmp('hermetic-seats-');
    process.env.CLASSIF_SEAT_HOMES = seatHomes;
    process.env.CLASSIF_HOME = home;
    process.env.CLASSIF_TEST_MODE = '1';
    delete process.env.CLASSIF_SPLIT_FILE;
    delete process.env.CLASSIF_REPO;
    delete process.env.CLASSIF_EVAL_DIR;
    delete process.env.CLASSIF_TEST_QUOTA_WAIT_MS;
    delete process.env.CLASSIF_ROLE;
    delete process.env.CLASSIF_BLIND_KEY;
    delete process.env.CLASSIF_ACTOR;
    delete process.env.CLASSIF_EVAL_KEY;
    const fakeAuth = path.join(home, 'fake-auth.json');
    writeFileSync(fakeAuth, '{"fake":"auth-for-hermetic-tests"}');
    process.env.CLASSIF_ASTRA_AUTH_SRC = fakeAuth;
    const fakeVibe = path.join(home, 'fake-vibe-config.toml');
    writeFileSync(fakeVibe, 'active_model = ""\n');
    process.env.CLASSIF_VIBE_CONFIG_SRC = fakeVibe;
    try { await fn(home); }
    finally { restoreEnv(saved); rmSync(home, { recursive: true, force: true }); rmSync(seatHomes, { recursive: true, force: true }); }
  };
}

/** Fresh temp git repo (user config set so commits work). */
export function initTempRepo() {
  const repo = tmp('hermetic-repo-');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: repo });
  return repo;
}

export function writeRepoFile(repo, rel, content) {
  const f = path.join(repo, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, content);
}

export function commitAll(repo, msg = 'fixture') {
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-qm', msg], { cwd: repo });
}

/** Halves shas, mirroring the split manifest body (sorted ids, trailing newline). */
export function splitShas(tuningIds, blindIds) {
  const body = (ids) => `${[...ids].sort().join('\n')}\n`;
  return { tuning: sha256(body(tuningIds)), blind: sha256(body(blindIds)) };
}

/**
 * Writes a hermetic series repo: frozen prompt, committed split and
 * pre-registered series manifest with matching halves. Commits everything.
 * Returns { promptSha256, shas }.
 */
export function writeSeriesRepo({ repo, k = '98', routes, tuningIds, blindIds,
  promptText, floors = { recall: 0.5, precision: 0.5 }, failureCeiling = 0.1,
  supports = { recall: 1000, precision: 1000 } }) {
  writeRepoFile(repo, `tools/classif/l4/prompts/P${k}.md`, promptText);
  const promptSha256 = sha256(promptText);
  const shas = splitShas(tuningIds, blindIds);
  writeRepoFile(repo, 'tools/classif/l3/manifests/split.json',
    JSON.stringify({ halves: { tuning: [...tuningIds].sort(), blind: [...blindIds].sort() }, sha256: shas }));
  writeRepoFile(repo, `tools/classif/l4/manifests/series-${k}.json`, JSON.stringify({
    kind: 'l4-series', promptSha256, routes,
    halves: { tuningSha256: shas.tuning, blindSha256: shas.blind },
    floors, failureCeiling, supports, budget: { cap: 22000, spent: 0 },
  }));
  commitAll(repo);
  return { promptSha256, shas };
}

/** Reads a fixture from the real checkout (read-only; never written back). */
export function readFixture(rel) {
  return readFileSync(path.join(CLASSIF_DIR, rel), 'utf8');
}
