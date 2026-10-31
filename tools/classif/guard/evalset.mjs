// Executor-side access to the sealed evaluation set (port of oracle-c lib/testset.mjs, plan §C.3).
// Opening requires CLASSIF_ROLE=test-executor and CLASSIF_EVAL_KEY (env only); the plaintext
// sha256 must match the README; every open is appended to the access log. A run requires a
// committed, unmodified frozen prompt and is allowed once per (prompt sha, model, effort).
// Per-item listing of the evaluation set is refused: callers get aggregates only.
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { keyFromEnv, sha256, unseal } from '../lib/refc1.mjs';
import { EVAL_DIR_DEFAULT, REPO } from '../lib/paths.mjs';
import { EVAL_FILES } from './unseal.mjs';

export const accessLog = (evalDir = EVAL_DIR_DEFAULT) => path.join(evalDir, 'access-log.jsonl');

export function audit(entry, { evalDir = EVAL_DIR_DEFAULT, env = process.env } = {}) {
  const rec = { at: new Date().toISOString(), actor: env.CLASSIF_ACTOR ?? os.userInfo().username, role: env.CLASSIF_ROLE ?? null, ...entry };
  appendFileSync(accessLog(evalDir), `${JSON.stringify(rec)}\n`);
  return rec;
}

export function readAudit(evalDir = EVAL_DIR_DEFAULT) {
  const f = accessLog(evalDir);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function expectedHashes(evalDir = EVAL_DIR_DEFAULT) {
  const readme = readFileSync(path.join(evalDir, 'README.md'), 'utf8');
  const out = {};
  for (const [k, name] of Object.entries(EVAL_FILES)) {
    const m = readme.match(new RegExp(`\\|\\s*\`${name.replace('.', '\\.')}\\.sealed\`\\s*\\|.*\\|\\s*\`([0-9a-f]{64})\`\\s*\\|`));
    if (!m) throw new Error(`${name}.sealed not listed in ${evalDir}/README.md`);
    out[k] = m[1];
  }
  return out;
}

/** Opens the evaluation set (inputs + expected). Returns { inputs, expected } arrays. */
export function openEvalSet({ purpose, promptSha256 = null, model = null, effort = null, evalDir = EVAL_DIR_DEFAULT, env = process.env }) {
  if (env.CLASSIF_ROLE !== 'test-executor') throw new Error('evaluation set refused: CLASSIF_ROLE must be test-executor');
  const key = keyFromEnv('CLASSIF_EVAL_KEY', env);
  const want = expectedHashes(evalDir);
  const out = {};
  for (const [k, name] of Object.entries(EVAL_FILES)) {
    const plain = unseal(key, readFileSync(path.join(evalDir, `${name}.sealed`)));
    if (sha256(plain) !== want[k]) throw new Error(`evaluation set refused: ${name} plaintext sha256 differs from README`);
    out[k] = plain.toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  }
  audit({ action: 'open-eval-set', purpose, datasetSha256: want, promptSha256, model, effort }, { evalDir, env });
  return out;
}

/** Guard before a run on the evaluation set. */
export function assertEvalRunAllowed({ promptFile, promptSha256, model, effort, evalDir = EVAL_DIR_DEFAULT, repo = REPO }) {
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  const rel = path.relative(repo, path.resolve(repo, promptFile));
  if (!existsSync(path.join(repo, rel))) throw new Error(`evaluation run refused: frozen prompt ${rel} not found`);
  if (sha256(readFileSync(path.join(repo, rel))) !== promptSha256) throw new Error('evaluation run refused: prompt sha256 differs from the frozen prompt');
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`evaluation run refused: ${rel} is not committed`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`evaluation run refused: ${rel} differs from the committed version`);
  const previous = readAudit(evalDir).filter((e) => e.action === 'eval-run' && e.promptSha256 === promptSha256 && e.model === model && e.effort === effort);
  if (previous.length) throw new Error(`evaluation run refused: prompt ${promptSha256.slice(0, 12)} already run with ${model}/${effort} (${previous[0].at})`);
  return { frozenIn: git('log', '-1', '--format=%H %cI', '--', rel).stdout.trim() };
}

/** Per-item output on the evaluation set is refused; only aggregates leave the executor. */
export function refuseItemListing(set) {
  if (set === 'eval' || set === 'test') throw new Error('per-item listing refused on the evaluation set (aggregates only)');
}
