import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync, writeFileSync, chmodSync } from 'node:fs';

export const CLASSIF_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO = path.resolve(CLASSIF_DIR, '..', '..');
export const REFC_DIR = path.join(REPO, 'docs', 'spec', 'reports', 'reference-c');
export const EVAL_DIR_DEFAULT = path.join(REPO, 'docs', 'spec', 'reports', 'classif-eval');
export const GOLD_STEVE_30 = path.join(REPO, 'docs', 'reports', 'recette', 'gold-steve-30.expected.json');
export const MIGRATION_CODES = path.join(REPO, 'api', 'drizzle', '0014_facets_signal.sql');

export const classifHome = (env = process.env) => path.resolve(env.CLASSIF_HOME ?? path.join(os.homedir(), '.local', 'share', 'radar-classif'));

/**
 * Explicit test mode for hermetic tests (review D1/D2). The hooks below are
 * honoured ONLY when `env.CLASSIF_TEST_MODE === '1'`; production paths refuse
 * them otherwise (fail closed). The live Astra pass never sets test mode, so
 * it never reads these overrides.
 */
export const isTestMode = (env = process.env) => env.CLASSIF_TEST_MODE === '1';

/**
 * Test-only env hook: returns `env[name]` in test mode, undefined when unset,
 * and throws in production when set (a test hook must never steer a live run).
 */
export function testOnlyEnv(env, name) {
  const v = (env ?? process.env)[name];
  if (v === undefined) return undefined;
  if ((env ?? process.env).CLASSIF_TEST_MODE !== '1') {
    throw new Error(`${name} is test-only (CLASSIF_TEST_MODE=1 required): production refused`);
  }
  return v;
}

/** Repo root: the CLASSIF_REPO override (tests) else the real checkout. Test-only. */
export function repoRoot(env = process.env) {
  const o = testOnlyEnv(env, 'CLASSIF_REPO');
  return o === undefined ? REPO : path.resolve(o);
}

/** tools/classif dir of the active repo (real checkout, or the temp repo in tests). */
export function classifDir(env = process.env) {
  const o = testOnlyEnv(env, 'CLASSIF_REPO');
  return o === undefined ? CLASSIF_DIR : path.join(path.resolve(o), 'tools', 'classif');
}

/** Creates `dir` in mode 700, or requires an existing one to be private (no group/other bits). */
export function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = statSync(dir);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`);
  if ((st.mode & 0o077) !== 0) chmodSync(dir, 0o700);
  return dir;
}

/** Writes a private file (mode 600) exclusively. */
export function writePrivate(file, data) {
  privateDir(path.dirname(file));
  writeFileSync(file, data, { flag: 'wx', mode: 0o600 });
}
