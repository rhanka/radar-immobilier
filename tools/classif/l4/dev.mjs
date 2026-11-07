#!/usr/bin/env node
// make classif-l4-dev SERIES=<k> ENV=preprod — series tuning-half evaluation (plan v3 C/D).
//
// Runs every evaluated route on the TUNING half only (never the blind half, never S113 here),
// one isolated seat call per item. Writes per-route tuning outputs + the optimiser error file
// (private, $CLASSIF_HOME/l4/series-k/) and a metrics-only repo manifest (Annex M: shown
// recall/precision, indeterminate supports, failures, cost). 0 blind access.
// Seat families (l4/families.mjs) run in parallel, routes of one family sequentially;
// --sequential keeps the former one-route-at-a-time order (same outputs).
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { callSeat, isCodexSeat, looksLikeMaxPrice, parseJsonObject } from '../run-seat.mjs';
import { CODEX_QUOTA_PAUSE_DEFAULT, createQuotaGuard, parseQuotaPause, quotaFields } from '../lib/codex-quota.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/render.mjs';
import { classifDir, classifHome, privateDir } from '../lib/paths.mjs';
import { buildRecallComparison, compareRoutes, routeFailed, seriesVerdict, shownMisses, shownStats } from './metrics.mjs';
import { assertSeriesHalves, assertSeriesRoutes, loadSeriesManifest, loadTuningRecallBaseline, seriesMethod } from './series.mjs';
import { GEPA_METHOD, gepaRouteVerdict, gepaSeriesVerdict, seriesRouteUniverse } from './gepa-common.mjs';
import { groupRoutesByFamily, runFamiliesParallel } from './families.mjs';
import { check as budgetCheck } from '../lib/budget.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';
import { loadCodes } from '../l2/run.mjs';

// Evaluated routes (plan v3 C–D): low and medium models. Argon runs once its seat quota is
// back; pass --deferred gemini-4-argon-low,gemini-4-argon-medium to skip it. The vibe
// per-level labels (glm-5.3-low, mistral-large-4-medium) already exist in run-seat.mjs.
export const EVAL_ROUTES = ['muse-spark-1.3-low', 'muse-spark-1.3-medium', 'opus-5.5-low', 'opus-5.5-medium',
  'mistral-large-4-medium', 'glm-5.3-low', 'gemini-4-argon-low', 'gemini-4-argon-medium'];

/**
 * Builds the evaluated prompt: frozen series prompt + one item. Exported for tests. S113 rows
 * carry `evalId` instead of `itemId` (they used to be sent as "item_id: undefined").
 */
export function devPrompt(frozenPrompt, item) {
  return `${frozenPrompt.trim()}\n\n## Item to classify\n\n### item_id: ${item.itemId ?? item.evalId}\n\n${item.input}\n`;
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

/**
 * One seat result → parsed answer, fail closed (review GEPA B1a): a non-zero exit or a timeout,
 * and ANY tool event (command, file read, MCP, web, unknown event) are failed calls of class
 * `infra` — never an accepted answer, never cached. A completed call is parsed by
 * parseDevAnswer; an invalid answer (no-json, unknown-code, verdict-not-partition) is a failure
 * of class `answer` (the model answered, badly). Failures count as shown (Annex M).
 */
export function parseSeatResult(r, codes) {
  // Review GEPA N6: a vibe --max-price stop is the model's answer exceeding the per-call ceiling —
  // an answer failure (deterministic per item), never an infrastructure failure nor a retry.
  if (r.code !== 0 && looksLikeMaxPrice(r)) return { verdict: null, code: null, failed: true, why: 'max-price', infra: false };
  if (r.code !== 0) return { verdict: null, code: null, failed: true, why: `exit-${r.code}`, infra: true };
  if ((r.toolEvents ?? 0) > 0) return { verdict: null, code: null, failed: true, why: 'tool-events', infra: true };
  return { ...parseDevAnswer(r.text, codes), infra: false };
}

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

/**
 * Selection over ranked routes (review D4, Annex M M.3): routes failing the
 * failure ceiling or with verdict `fail` are excluded — best is the first
 * eligible route, null when every route failed. Exported for the selection test.
 */
export function selectBest(ranked) {
  const eligible = ranked.filter((r) => !routeFailed(r));
  return { order: ranked.map((r) => r.route), best: eligible[0]?.route ?? null,
    excluded: ranked.filter((r) => routeFailed(r)).map((r) => r.route) };
}

/**
 * Per-item dev cache read (review §8): returns the cached row only when the stored key
 * (series,promptSha256,route,itemId) matches exactly; corrupt or stale entries read as null
 * (re-run). Exported for the resume test.
 */
export function readDevItemCache(dir, route, itemId, k, promptSha) {
  const f = path.join(dir, `dev-${route}.${itemId}.json`);
  if (!existsSync(f)) return null;
  try {
    const c = JSON.parse(readFileSync(f, 'utf8'));
    if (c.series === String(k) && c.promptSha256 === promptSha && c.route === route && c.itemId === itemId) return c.row;
  } catch { /* corrupt cache: re-run */ }
  return null;
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
  // A GEPA series (series-<k>.json method gepa) evaluates the 4 GEPA routes instead.
  const routes = seriesRouteUniverse(seriesMethod(k), EVAL_ROUTES).filter((r) => !deferred.includes(r));
  const concurrency = Number(argv.includes('--concurrency') ? argv[argv.indexOf('--concurrency') + 1] : 2);
  // ChatGPT quota guard (codex seats share the weekly quota with the production detection).
  const quotaPause = parseQuotaPause(argv.includes('--codex-quota-pause') ? argv[argv.indexOf('--codex-quota-pause') + 1] : undefined);
  const quotaGuard = createQuotaGuard({ threshold: quotaPause, isCodex: isCodexSeat });
  const resumeCommand = `make classif-l4-dev SERIES=${k}${deferred.length ? ` DEFERRED=${deferred.join(',')}` : ''}${quotaPause !== CODEX_QUOTA_PAUSE_DEFAULT ? ` CODEX_QUOTA_PAUSE=${quotaPause}` : ''} ENV=preprod`;
  const home = classifHome();
  const promptFile = path.join(classifDir(process.env), 'l4', 'prompts', `P${k}.md`);
  if (!existsSync(promptFile)) { process.stderr.write(`classif-l4-dev: frozen prompt P${k} missing (run make classif-l4-p0 / optimise first)\n`); process.exit(2); }
  const frozen = readFileSync(promptFile, 'utf8');
  const promptSha = sha256(frozen);
  // Review §11b: re-scan the frozen prompt on every run — an edited then recommitted
  // prompt with an updated series manifest must not bypass the verbatim guard.
  assertNoVerbatim(frozen, home, { what: `prompt P${k}` });
  // Review §9 (M.5): the pre-registered series manifest is required before dev.
  const seriesSpec = loadSeriesManifest(k);
  if (seriesSpec.promptSha256 !== promptSha) throw new Error(`classif-l4-dev: frozen prompt P${k} sha differs from the pre-registered series manifest`);
  // Review §9b: the executed routes must match the pre-registered series (a --deferred
  // that changes the series makes it exploratory, not the registered one), and the
  // frozen halves must match the split draw (plain read — L2 already enforced committed).
  assertSeriesRoutes(seriesSpec, routes, k);
  // Owner rule 06/11 (manifests declaring recallNonRegression): the tuning recall baseline is
  // loaded before any paid call; a route below it fails whatever its precision.
  const recallBaseline = loadTuningRecallBaseline(seriesSpec, k);
  try {
    const splitFile = path.join(classifDir(process.env), 'l3', 'manifests', 'split.json');
    if (existsSync(splitFile)) {
      const split = JSON.parse(readFileSync(splitFile, 'utf8'));
      if (split.sha256) assertSeriesHalves(seriesSpec, k, split.sha256);
    }
  } catch (e) {
    if (/halves|refused/.test(e.message)) throw e;
    throw e;
  }
  const codes = loadCodes();
  const tuning = readTuning(home);
  if (tuning.some((r) => !r.input)) throw new Error('classif-l4-dev: tuning row without frozen input');
  const dir = privateDir(path.join(home, 'l4', `series-${k}`));
  // Review §5 (D5): planned counts only non-cached items — a resume with 1 item left
  // is not refused near the cap.
  let uncachedDev = 0;
  for (const route of routes) {
    for (const item of tuning) {
      if (!readDevItemCache(dir, route, item.itemId, k, promptSha)) uncachedDev++;
    }
  }
  budgetCheck(home, uncachedDev);
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  const seatTmp = privateDir(path.join(home, 'l4', 'seat-tmp'));
  // Seat-family parallelism: families run in parallel, routes inside one family run
  // sequentially with the existing per-route concurrency (per-seat limit unchanged).
  // Per-item caches and per-route files are written inside the route task, so a
  // family failure keeps the cached items of the other families on disk.
  const runDevRoute = async (route) => {
    const outFile = path.join(dir, `dev-${route}.jsonl`);
    // Review §8: per-item persistence with key (series,promptSha,route,itemId) verified on
    // resume — a crash never repays finished items, a changed prompt never reuses stale rows.
    // Review §9: the predicted code is kept (pred.verdict + pred.code).
    const loadCached = (itemId) => readDevItemCache(dir, route, itemId, k, promptSha);
    const rows = await pool(tuning.map((item) => async () => {
      const hit = loadCached(item.itemId);
      if (hit) return hit;
      if (quotaGuard.blocks(route)) return null;
      const prompt = devPrompt(frozen, item);
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: true, phase: `l4-dev-s${k}`, route, itemId: item.itemId });
      const r = await callSeat(route, prompt, { base: seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: `l4-dev-s${k}`, route, itemId: item.itemId,
        exitCode: r.code, latencyMs: r.latencyMs, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null, toolEvents: r.toolEvents ?? null, ...quotaFields(r) });
      quotaGuard.observe(route, r.rateLimits);
      const parsed = parseSeatResult(r, codes);
      const row = { itemId: item.itemId, ref: item.code, refVerdict: item.verdict, unresolved: item.status === 'unresolved',
        pred: parsed.failed ? null : { verdict: parsed.verdict, code: parsed.code }, failed: parsed.failed, why: parsed.why,
        usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null };
      // Review N4: failures are never cached — retried on resume with a new counted intent.
      if (!row.failed) {
        writeFileSync(path.join(dir, `dev-${route}.${item.itemId}.json`),
          JSON.stringify({ series: String(k), promptSha256: promptSha, route, itemId: item.itemId, row }), { mode: 0o600 });
      }
      return row;
    }), concurrency);
    // Answered items are cached above; a paused codex route stops the run before any aggregate.
    if (quotaGuard.paused && isCodexSeat(route)) throw quotaGuard.error(resumeCommand);
    writeFileSync(outFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, { mode: 0o600 });
    return rows;
  };
  const perRoute = {};
  if (argv.includes('--sequential')) {
    for (const route of routes) perRoute[route] = await runDevRoute(route);
  } else {
    const byRoute = await runFamiliesParallel(groupRoutesByFamily(routes), runDevRoute);
    for (const route of routes) perRoute[route] = byRoute.get(route);
  }
  // Aggregates (Annex M) + the optimiser error file (tuning mismatches for the optimiser input).
  // Review §9: metrics published WITH and WITHOUT unresolved rows; verdict from the series spec.
  // Review §9a: indeterminate supports come from the pre-registered series manifest.
  const devSupports = seriesSpec.supports ?? {};
  const specFailureCeiling = seriesSpec.failureCeiling ?? 0.1;
  const aggregates = {};
  for (const [route, rows] of Object.entries(perRoute)) {
    const stats = shownStats(rows.map((r) => ({ ref: r.refVerdict, pred: r.failed ? { failed: true } : r.pred, unresolved: r.unresolved })),
      { recallSupport: devSupports.recall ?? 30, precisionSupport: devSupports.precision ?? 30 });
    const statsWithUnresolved = shownStats(rows.map((r) => ({ ref: r.refVerdict, pred: r.failed ? { failed: true } : r.pred, unresolved: false })),
      { recallSupport: devSupports.recall ?? 30, precisionSupport: devSupports.precision ?? 30 });
    const failures = rows.filter((r) => r.failed).length;
    // GEPA series: pass only with 0 miss and failures within the ceiling (no floor).
    if (seriesSpec.method === GEPA_METHOD) {
      // Failure share over the RESOLVED rows (the rows a miss can be counted on).
      const resolved = rows.filter((r) => !r.unresolved);
      const g = gepaRouteVerdict({ misses: shownMisses(rows).length, failures: resolved.filter((r) => r.failed).length, items: resolved.length }, specFailureCeiling);
      aggregates[route] = { ...stats, failures, withUnresolved: statsWithUnresolved, misses: g.misses, verdict: g.verdict,
        costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0), items: rows.length };
      continue;
    }
    const spec = { recallFloor: seriesSpec.floors?.recall ?? 0, precisionFloor: seriesSpec.floors?.precision ?? 0,
      failureCeiling: specFailureCeiling,
      ...(recallBaseline ? { baselineRecall: recallBaseline.recall[route] ?? null, recallTolerance: recallBaseline.tolerance } : {}) };
    aggregates[route] = { ...stats, failures,
      withUnresolved: statsWithUnresolved,
      verdict: seriesVerdict ? seriesVerdict({ stats, failures, items: rows.length }, spec) : null,
      costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
      items: rows.length };
  }
  // Review §9: errors carry failures and code errors (not verdict mismatches only).
  const errors = {};
  for (const [route, rows] of Object.entries(perRoute)) {
    errors[route] = rows.filter((r) => !r.unresolved && (r.failed || r.pred?.verdict !== r.refVerdict || r.pred?.code !== r.ref))
      .map((r) => ({ itemId: r.itemId, ref: r.ref, refVerdict: r.refVerdict, pred: r.pred?.verdict ?? null, predCode: r.pred?.code ?? null, failed: r.failed, why: r.why ?? null }));
  }
  writeFileSync(path.join(dir, `errors.json`), `${JSON.stringify(errors, null, 1)}\n`, { mode: 0o600 });
  // Review §9d (M.3): lexicographic selection wired on the tuning half (compareRoutes is
  // no longer test-only) — recall LB, recall, precision LB, precision, prompt version, cost.
  // Review D4: the ranked entries carry failures/verdict/items/ceiling so failing
  // routes sort last and are excluded from best.
  const ranked = Object.entries(aggregates)
    .map(([route, a]) => ({ route, stats: { recallLB: a.recallLB, recall: a.recall, precisionLB: a.precisionLB, precision: a.precision, indeterminate: a.indeterminate },
      promptVersion: `P${k}`, costUsd: a.costUsd ?? 0, failures: a.failures, verdict: a.verdict, items: a.items, failureCeiling: specFailureCeiling }))
    .sort(compareRoutes);
  const selection = selectBest(ranked);
  const manifest = { kind: 'l4-dev', series: k, createdAt: new Date().toISOString(), promptSha256: promptSha,
    routes, deferred, tuningItems: tuning.length, aggregates,
    ...(seriesSpec.method === GEPA_METHOD ? { method: GEPA_METHOD, gepa: { ...gepaSeriesVerdict(aggregates, seriesSpec.routes),
      rule: 'pass only when every GEPA route has 0 miss (P/S predicted non_pertinent) and a failure share within the ceiling; precision reported, no floor' } } : {}),
    ...(recallBaseline ? { recallNonRegression: { baselineSeries: recallBaseline.baselineSeries, half: 'tuning', metric: 'recall',
      tolerance: recallBaseline.tolerance, rule: 'a route whose recall point estimate is below the baseline recall of the same route fails, whatever its precision',
      routes: buildRecallComparison(perRoute, aggregates, recallBaseline) } } : {}),
    selection: { order: selection.order, best: selection.best, excluded: selection.excluded, criterion: 'M.3 lexicographic (tuning half only, failing routes excluded)' },
    trackNote: 'per-item tuning outputs stay private (optimiser input); this manifest carries metrics only' };
  mkdirSync(path.join(classifDir(process.env), 'l4', 'manifests'), { recursive: true });
  writeFileSync(path.join(classifDir(process.env), 'l4', 'manifests', `series-${k}-dev.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'dev.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-dev: ${err.stack}\n`); process.exit(1); });
}
