// Executor-side access to the sealed blind half (plan v3 D3, same guard as guard/evalset.mjs).
// Opening requires CLASSIF_ROLE=test-executor and CLASSIF_BLIND_KEY (env only); the plaintext
// sha256 must match the committed split/reference manifests; every open is appended to the
// blind access log. A run requires a committed, unmodified frozen prompt and is allowed once
// per (prompt sha, model, effort). Per-item listing of the blind half is refused: callers get
// aggregates only. Sealed aggregates land in $CLASSIF_HOME/blind/; only the owner reads them.
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { keyFromEnv, sha256, sealToFile, unseal } from './refc1.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from './jsonl.mjs';
import { repoRoot, classifHome, privateDir } from './paths.mjs';
import { Buffer } from 'node:buffer';

export const blindDir = (home = classifHome()) => path.join(home, 'blind');
export const sealedFile = (home = classifHome()) => path.join(blindDir(home), 'blind.sealed');
export const accessLog = (home = classifHome()) => path.join(blindDir(home), 'access-log.jsonl');

export function audit(entry, { home = classifHome(), env = process.env } = {}) {
  const rec = { at: new Date().toISOString(), actor: env.CLASSIF_ACTOR ?? os.userInfo().username, role: env.CLASSIF_ROLE ?? null, ...entry };
  appendJsonlRecord(accessLog(home), rec);
  return rec;
}

export function readAudit(home = classifHome()) {
  const f = accessLog(home);
  if (!existsSync(f)) return [];
  return parseJsonlTolerant(readFileSync(f, 'utf8'));
}

/** Seals blind-half rows (inputs + expected, JSONL bytes) under CLASSIF_BLIND_KEY. */
export function sealBlindSet(rows, { home = classifHome(), env = process.env } = {}) {
  const key = keyFromEnv('CLASSIF_BLIND_KEY', env);
  const plain = Buffer.from(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  privateDir(blindDir(home));
  const target = sealedFile(home);
  if (existsSync(target)) throw new Error(`refusing to overwrite existing blind seal: ${target}`);
  const r = sealToFile(key, plain, target);
  chmodSync(target, 0o600);
  audit({ action: 'seal-blind-set', rows: rows.length, plainSha256: r.plainSha256, sealedSha256: r.sealedSha256 }, { home, env });
  return r;
}

/** Opens the blind half (executor only). Returns the rows array. */
export function openBlindSet({ purpose, promptSha256 = null, model = null, effort = null, home = classifHome(), env = process.env, expectPlainSha256 = null } = {}) {
  if (env.CLASSIF_ROLE !== 'test-executor') throw new Error('blind set refused: CLASSIF_ROLE must be test-executor');
  const key = keyFromEnv('CLASSIF_BLIND_KEY', env);
  const plain = unseal(key, readFileSync(sealedFile(home)));
  if (expectPlainSha256 && sha256(plain) !== expectPlainSha256) throw new Error('blind set refused: plaintext sha256 differs from the reference manifest');
  const rows = plain.toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  audit({ action: 'open-blind-set', purpose, datasetSha256: sha256(plain), promptSha256, model, effort }, { home, env });
  return rows;
}

/** Guard before a run on the blind half (mirrors assertEvalRunAllowed).
    Review D2: in test mode the temp repo applies (never the real checkout).
    One run per (prompt sha, model, effort), plus exactly one more per audited
    `blind-rerun-infra` allowance (l4/blind.mjs --rerun-infra-failed). `extraAllowance`
    lets the re-run eligibility check run this guard before its allowance is written. */
export function assertBlindRunAllowed({ promptFile, promptSha256, model, effort, home = classifHome(), repo = null, extraAllowance = 0 }) {
  const root = repo ?? repoRoot(process.env);
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const rel = path.relative(root, path.resolve(root, promptFile));
  if (!existsSync(path.join(root, rel))) throw new Error(`blind run refused: frozen prompt ${rel} not found`);
  if (sha256(readFileSync(path.join(root, rel))) !== promptSha256) throw new Error('blind run refused: prompt sha256 differs from the frozen prompt');
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`blind run refused: ${rel} is not committed`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`blind run refused: ${rel} differs from the committed version`);
  const log = readAudit(home);
  const tuple = (e) => e.promptSha256 === promptSha256 && e.model === model && e.effort === effort;
  const previous = log.filter((e) => e.action === 'blind-run' && tuple(e));
  const allowances = log.filter((e) => e.action === 'blind-rerun-infra' && tuple(e)).length + extraAllowance;
  if (previous.length > allowances) throw new Error(`blind run refused: prompt ${promptSha256.slice(0, 12)} already run with ${model}/${effort} (${previous[0].at})`);
  return { frozenIn: git('log', '-1', '--format=%H %cI', '--', rel).stdout.trim() };
}

/** Per-item output on the blind half is refused; only aggregates leave the executor. */
export function refuseBlindListing(set) {
  if (set === 'blind' || set === 'tuning') throw new Error(`per-item listing refused on the ${set} half (aggregates only)`);
}
