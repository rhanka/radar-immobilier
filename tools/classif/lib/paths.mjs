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
