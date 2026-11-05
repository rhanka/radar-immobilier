#!/usr/bin/env node
// make classif-l4-dev SERIES=<k> ENV=preprod — series tuning-half evaluation (plan v3 C/D).
//
// Runs every evaluated route on the TUNING half only (never the blind half, never S113 here),
// one isolated seat call per item. Writes per-route tuning outputs + the optimiser error file
// (private, $CLASSIF_HOME/l4/series-k/) and a metrics-only repo manifest (Annex M: shown
// recall/precision, indeterminate supports, failures, cost). 0 blind access.
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROUTES, callSeat, parseJsonObject } from '../run-seat.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, classifHome, privateDir } from '../lib/paths.mjs';
import { shownStats } from './metrics.mjs';
import { check as budgetCheck } from '../lib/budget.mjs';
import { loadCodes } from '../l2/run.mjs';

// Evaluated routes (plan v3 C–D): low and medium models. Argon runs once its seat quota is
// back; pass --deferred gemini-4-argon-low,gemini-4-argon-medium to skip it. The vibe
// per-level labels (glm-5.3-low, mistral-large-4-medium) already exist in run-seat.mjs.
export const EVAL_ROUTES = ['muse-spark-1.3-low', 'muse-spark-1.3-medium', 'opus-5.5-low', 'opus-5.5-medium',
  'mistral-large-4-medium', 'glm-5.3-low', 'gemini-4-argon-low', 'gemini-4-argon-medium'];

/** Builds the evaluated prompt: frozen series prompt + one item. Exported for tests. */
export function devPrompt(frozenPrompt, item) {
  return `${frozenPrompt.trim()}\n\n## Item to classify\n\n### item_id: ${item.itemId}\n\n${item.input}\n`;
}

/**
 * Parses one evaluated answer. Exported for tests. Returns { verdict, code, failed, why }.
 * A non-JSON answer, an unknown code, or a verdict that is not the code partition = failure
 * (Annex M: failures count as shown, fail closed).
 */
export function parseDevAnswer(text, codes) {
  const j = parseJsonObject(text);
  if (!j) return { verdict: null, code: null, failed: true, why: 'no-json' };
  const code = String(j.code ?? '');
  if (!codes.has(code)) return { verdict: null, code, failed: true, why: 'unknown-code' };
  if (j.verdict !== codes.get(code)) return { verdict: j.verdict ?? null, code, failed: true, why: 'verdict-not-partition' };
  return { verdict: j.verdict, code, failed: false, why: null };
}

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

export function readTuning(home) {
  const ref = parseJsonlTolerant(readFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), 'utf8'));
  const corpus = new Map(parseJsonlTolerant(readFileSync(path.join(home, 'l0', 'dev-items.jsonl'), 'utf8')).map((i) => [i.itemId, i]));
  return ref.filter((r) => r.half === 'tuning').map((r) => ({ ...r, input: corpus.get(r.itemId)?.input ?? null }));
}

export async function main(argv = process.argv.slice(2)) {
  const k = argv.includes('--series') ? argv[argv.indexOf('--series') + 1] : process.env.SERIES;
  if (!k) { process.stderr.write('classif-l4-dev: pass SERIES=<k>\n'); process.exit(2); }
  const deferred = argv.includes('--deferred') ? argv[argv.indexOf('--deferred') + 1].split(',').filter(Boolean) : [];
  const routes = EVAL_ROUTES.filter((r) => !deferred.includes(r));
  const concurrency = Number(argv.includes('--concurrency') ? argv[argv.indexOf('--concurrency') + 1] : 2);
  const home = classifHome();
  const promptFile = path.join(CLASSIF_DIR, 'l4', 'prompts', `P${k}.md`);
  if (!existsSync(promptFile)) { process.stderr.write(`classif-l4-dev: frozen prompt P${k} missing (run make classif-l4-p0 / optimise first)\n`); process.exit(2); }
  const frozen = readFileSync(promptFile, 'utf8');
  const promptSha = sha256(frozen);
  const codes = loadCodes();
  const tuning = readTuning(home);
  if (tuning.some((r) => !r.input)) throw new Error('classif-l4-dev: tuning row without frozen input');
  // D5: the whole series batch is refused when it would exceed the pilot cap.
  budgetCheck(home, tuning.length * routes.length);
  const dir = privateDir(path.join(home, 'l4', `series-${k}`));
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  const seatTmp = privateDir(path.join(home, 'l4', 'seat-tmp'));
  const perRoute = {};
  for (const route of routes) {
    const outFile = path.join(dir, `dev-${route}.jsonl`);
    if (existsSync(outFile)) {
      perRoute[route] = parseJsonlTolerant(readFileSync(outFile, 'utf8'));
      continue;
    }
    const rows = await pool(tuning.map((item) => async () => {
      const prompt = devPrompt(frozen, item);
      const r = await callSeat(route, prompt, { base: seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), phase: `l4-dev-s${k}`, route, itemId: item.itemId,
        exitCode: r.code, latencyMs: r.latencyMs, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null });
      const parsed = r.code === 0 ? parseDevAnswer(r.text, codes) : { verdict: null, code: null, failed: true, why: `exit-${r.code}` };
      return { itemId: item.itemId, ref: item.code, refVerdict: item.verdict, unresolved: item.status === 'unresolved',
        pred: parsed.failed ? null : { verdict: parsed.verdict }, failed: parsed.failed, why: parsed.why,
        usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null };
    }), concurrency);
    writeFileSync(outFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, { mode: 0o600 });
    perRoute[route] = rows;
  }
  // Aggregates (Annex M) + the optimiser error file (tuning mismatches for the optimiser input).
  const aggregates = {};
  for (const [route, rows] of Object.entries(perRoute)) {
    const stats = shownStats(rows.map((r) => ({ ref: r.refVerdict, pred: r.failed ? { failed: true } : r.pred, unresolved: r.unresolved })));
    const failures = rows.filter((r) => r.failed).length;
    aggregates[route] = { ...stats, failures,
      costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
      items: rows.length };
  }
  const errors = {};
  for (const [route, rows] of Object.entries(perRoute)) {
    errors[route] = rows.filter((r) => !r.unresolved && !r.failed && r.pred?.verdict !== r.refVerdict)
      .map((r) => ({ itemId: r.itemId, ref: r.ref, refVerdict: r.refVerdict, pred: r.pred?.verdict }));
  }
  writeFileSync(path.join(dir, `errors.json`), `${JSON.stringify(errors, null, 1)}\n`, { mode: 0o600 });
  const manifest = { kind: 'l4-dev', series: k, createdAt: new Date().toISOString(), promptSha256: promptSha,
    routes, deferred, tuningItems: tuning.length, aggregates,
    trackNote: 'per-item tuning outputs stay private (optimiser input); this manifest carries metrics only' };
  mkdirSync(path.join(CLASSIF_DIR, 'l4', 'manifests'), { recursive: true });
  writeFileSync(path.join(CLASSIF_DIR, 'l4', 'manifests', `series-${k}-dev.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'dev.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-dev: ${err.stack}\n`); process.exit(1); });
}
