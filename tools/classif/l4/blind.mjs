#!/usr/bin/env node
// make classif-l4-blind SERIES=<k> ENV=preprod — blind-half scoring (plan v3 D3), EXECUTOR ONLY.
//
// One shot per (prompt sha, route) on the blind half, opened with CLASSIF_BLIND_KEY under the
// test-executor role (lib/blind.mjs: role, key, plaintext hash, access log, one run per tuple,
// per-item listing refused). Aggregates stay in $CLASSIF_HOME/blind/ (owner only); the repo
// manifest and stdout carry only the aggregates sha256 (D3 adaptation ban, review §1).
// Nothing from the blind half ever enters an optimiser input. S113 runs as a SECONDARY
// measure (flagged golden-exposed, diagnostic, outside selection).
// Seat families (l4/families.mjs) run in parallel, routes of one family sequentially;
// --sequential keeps the former one-route-at-a-time order (same outputs).
import path from 'node:path';
import process from 'node:process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { ROUTES, callSeat, isCodexSeat } from '../run-seat.mjs';
import { CODEX_QUOTA_PAUSE_DEFAULT, createQuotaGuard, parseQuotaPause, quotaFields } from '../lib/codex-quota.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from '../lib/jsonl.mjs';
import { sha256, stableStringify } from '../lib/render.mjs';
import { EVAL_DIR_DEFAULT, classifDir, repoRoot, testOnlyEnv, classifHome, privateDir } from '../lib/paths.mjs';
import { EVAL_ROUTES, devPrompt, parseSeatResult } from './dev.mjs';
import { pertinentMasked, recallRegressed, seriesVerdict, shownMisses, shownStats } from './metrics.mjs';
import { GEPA_METHOD, gepaRouteVerdict, gepaSeriesVerdict, seriesRouteUniverse } from './gepa-common.mjs';
import { check as budgetCheck } from '../lib/budget.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';
import { loadCodes } from '../l2/run.mjs';
import { assertBlindRunAllowed, audit, blindDir, openBlindSet, readAudit } from '../lib/blind.mjs';
import { assertEvalRunAllowed, audit as auditEval, openEvalSet, readAudit as readEvalAudit } from '../guard/evalset.mjs';
import { assertSeriesHalves, assertSeriesRoutes, gepaSeriesRoutes, loadSeriesManifest, seriesMethod } from './series.mjs';
import { groupRoutesByFamily, runFamiliesParallel } from './families.mjs';

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

/**
 * Reduced repo manifest for a blind series (review §1, D3 adaptation ban): exactly
 * {series, promptSha256, routes, blindItems, aggregatesSha256} plus kind/createdAt/note —
 * NEVER perRoute, s113, stats or recall. Exported for the firewall test.
 */
/**
 * An S113 route is done only when its file verifies at the prompt sha AND the
 * eval-run audit exists (review N2/D3): the same predicate drives the budget
 * plan and the skip, so a stale or audit-less file is re-run instead of being
 * under-counted then fail-closed by the guard. Exported for the resume test.
 */
export function isS113Done({ outDir, k, promptSha, route, evalDir = EVAL_DIR_DEFAULT }) {
  const { model, effort } = ROUTES[route];
  const s113File = path.join(outDir, `s113-series-${k}-${route}.json`);
  if (!existsSync(s113File)) return false;
  try {
    const prev = JSON.parse(readFileSync(s113File, 'utf8'));
    if (prev.promptSha256 !== promptSha || String(prev.series) !== String(k) || prev.route !== route) return false;
  } catch { return false; }
  try {
    return readEvalAudit(evalDir).some((e) => e.action === 'eval-run' && e.promptSha256 === promptSha && e.model === model && e.effort === effort
      && String(e.purpose ?? '').includes(`l4-s113-s${k}`));
  } catch { return false; }
}

/** Typed refusal of an infrastructure re-run (`code` says which rule refused). */
export class BlindRerunRefused extends Error {
  constructor(code, message) {
    super(`blind infra re-run refused (${code}): ${message}`);
    this.name = 'BlindRerunRefused';
    this.code = code;
  }
}

/** A route may be re-run for infrastructure only if it answered at most 1% of the items. */
export const INFRA_RERUN_MAX_ANSWERED_RATE = 0.01;

/**
 * Eligibility of one infrastructure re-run (pure reads, nothing written). Allowed only
 * when the previous run of the route in this series answered at most 1% of the blind
 * items, so nothing about the blind half can have been learned from it. Answered is
 * the max of: route-file items minus failures, distinct blind items with a seat answer
 * (exitCode 0) in calls.jsonl, and valid per-item caches. The route file must agree with
 * its blind-run audit and calls.jsonl must hold a terminal record for every failure.
 * One re-run per route: an audited allowance already consumed refuses; an allowance not
 * yet consumed (interrupted re-run) resumes. Exported for the re-run tests.
 */
export function assessInfraRerun({ home, outDir, k, promptSha, route, blindIds, callsLog }) {
  const { model, effort } = ROUTES[route];
  const log = readAudit(home);
  const tuple = (e) => e.promptSha256 === promptSha && e.model === model && e.effort === effort;
  const runs = log.filter((e) => e.action === 'blind-run' && tuple(e));
  const allowances = log.filter((e) => e.action === 'blind-rerun-infra' && tuple(e));
  if (allowances.length) {
    if (runs.length > allowances.length) throw new BlindRerunRefused('already-rerun', `${route} was already re-run once (${allowances[0].at})`);
    return { route, model, effort, resume: true };
  }
  if (runs.length !== 1 || !String(runs[0].purpose ?? '').includes(`l4-blind-s${k}`)) {
    throw new BlindRerunRefused('no-previous-run', `${route} has ${runs.length} completed blind run(s) in series ${k}, exactly 1 required`);
  }
  const routeFile = path.join(outDir, `series-${k}-${route}.json`);
  let prev;
  try { prev = JSON.parse(readFileSync(routeFile, 'utf8')); } catch { throw new BlindRerunRefused('route-file-mismatch', `${route} route file is missing or unreadable`); }
  if (String(prev.series) !== String(k) || prev.route !== route || prev.promptSha256 !== promptSha || !Number.isInteger(prev.failures)) {
    throw new BlindRerunRefused('route-file-mismatch', `${route} route file does not match series ${k} at the frozen prompt`);
  }
  const items = blindIds.length;
  if (runs[0].items !== items || runs[0].failures !== prev.failures) {
    throw new BlindRerunRefused('audit-mismatch', `${route} route file disagrees with its blind-run audit`);
  }
  const ids = new Set(blindIds);
  const calls = existsSync(callsLog) ? parseJsonlTolerant(readFileSync(callsLog, 'utf8')) : [];
  const terminal = calls.filter((c) => c.intent === false && c.phase === `l4-blind-s${k}` && c.route === route && ids.has(c.itemId));
  const exitCodes = {};
  for (const c of terminal) exitCodes[String(c.exitCode)] = (exitCodes[String(c.exitCode)] ?? 0) + 1;
  const callsAnswered = new Set(terminal.filter((c) => c.exitCode === 0).map((c) => c.itemId)).size;
  const callsTerminalItems = new Set(terminal.map((c) => c.itemId)).size;
  if (callsTerminalItems < prev.failures) {
    throw new BlindRerunRefused('calls-mismatch', `${route}: calls.jsonl has terminal records for ${callsTerminalItems} items, the route file records ${prev.failures} failed`);
  }
  let cachedItems = 0;
  for (const itemId of blindIds) {
    try {
      const c = JSON.parse(readFileSync(path.join(outDir, `blind-s${k}-${route}.${itemId}.json`), 'utf8'));
      if (c.series === String(k) && c.promptSha256 === promptSha && c.route === route && c.itemId === itemId) cachedItems++;
    } catch { /* not cached */ }
  }
  const routeFileAnswered = items - prev.failures;
  const previousAnswered = Math.max(routeFileAnswered, callsAnswered, cachedItems);
  const maxAnswered = Math.floor(items * INFRA_RERUN_MAX_ANSWERED_RATE);
  const counts = { items, routeFileFailed: prev.failures, routeFileAnswered, callsAnswered, callsTerminalItems, cachedItems, exitCodes };
  if (previousAnswered > maxAnswered) {
    throw new BlindRerunRefused('answered-above-threshold', `${route} answered ${previousAnswered} of ${items} items (max ${maxAnswered}, 1%)`);
  }
  const codes = Object.entries(exitCodes).map(([c, n]) => `${c}x${n}`).join(',') || 'none';
  const reason = `seat infrastructure failure: ${previousAnswered}/${items} items answered (route file ${prev.failures}/${items} failed, `
    + `calls.jsonl exitCode 0 on ${callsAnswered} items, ${cachedItems} cached), terminal exit codes ${codes}`;
  return { route, model, effort, resume: false, previousAnswered, maxAnswered, counts, reason };
}

/**
 * Blind recall baseline of a series declaring recallNonRegression (owner rule 06/11), read
 * inside the executor from the PRIVATE `series-<baseline>-aggregates.json` (aggregates only).
 * Per route: the baseline recall point estimate, or 'unknown' when the file, the route or its
 * recall is missing, or when the baseline route is infra-failed (failure share above the
 * failure ceiling — a failed row counts as shown, so its recall is not a measure — or an
 * audited infra re-run of it not yet completed). Returns null when the field is absent.
 * Exported for the non-regression tests.
 */
export function loadBlindRecallBaseline({ seriesSpec, outDir, home, routes, items }) {
  const r = seriesSpec?.recallNonRegression;
  if (r === undefined) return null;
  const b = String(r.baselineSeries);
  let agg = null;
  try {
    const a = JSON.parse(readFileSync(path.join(outDir, `series-${b}-aggregates.json`), 'utf8'));
    if (String(a.series) === b && a.perRoute && typeof a.perRoute === 'object') agg = a;
  } catch { /* unknown */ }
  const ceiling = seriesSpec.failureCeiling ?? 0.1;
  const log = readAudit(home);
  const recall = {};
  for (const route of routes) {
    const p = agg?.perRoute?.[route];
    const { model, effort } = ROUTES[route] ?? {};
    const ofBaseline = (e) => e.model === model && e.effort === effort && String(e.purpose ?? '').includes(`l4-blind-s${b}`);
    const allowances = log.filter((e) => e.action === 'blind-rerun-infra' && ofBaseline(e)).length;
    const runs = log.filter((e) => e.action === 'blind-run' && ofBaseline(e)).length;
    const pendingRerun = allowances > 0 && runs <= allowances;
    const infraFailed = !Number.isInteger(p?.failures) || !items || p.failures / items > ceiling;
    recall[route] = (typeof p?.recall === 'number' && !infraFailed && !pendingRerun) ? p.recall : 'unknown';
  }
  return { baselineSeries: r.baselineSeries, tolerance: r.tolerance, recall };
}

/**
 * Blind route verdict with the recall non-regression gate: below the baseline recall minus the
 * tolerance is `fail` (seriesVerdict); an 'unknown' baseline turns a `pass` into
 * `indeterminate` (never pass) and keeps a `fail` the route earned on its own failures or floors.
 * Without baseline the verdict and the route entry are unchanged. Exported for the tests.
 */
export function blindRouteVerdict({ stats, failures, items }, seriesSpec, baseline, route) {
  const spec = { recallFloor: seriesSpec.floors?.recall ?? 0, precisionFloor: seriesSpec.floors?.precision ?? 0, failureCeiling: seriesSpec.failureCeiling ?? 0.1 };
  if (!baseline) return { verdict: seriesVerdict({ stats, failures, items }, spec) };
  const base = baseline.recall[route] ?? 'unknown';
  if (base === 'unknown') {
    const v = seriesVerdict({ stats, failures, items }, spec);
    return { verdict: v === 'pass' ? 'indeterminate' : v, regressed: false, baselineRecall: 'unknown' };
  }
  const verdict = seriesVerdict({ stats, failures, items }, { ...spec, baselineRecall: base, recallTolerance: baseline.tolerance });
  return { verdict, regressed: recallRegressed(stats?.recall, base, baseline.tolerance), baselineRecall: base };
}

/**
 * GEPA blind route gate (series declaring method gepa): `pass` only with 0 miss on the blind
 * half (reference P/S predicted non_pertinent, a failed call counts as shown) AND a call
 * failure share within the pre-registered ceiling (<= 5 %). Precision stays in the private
 * aggregates, never a floor. Exported for the GEPA blind tests.
 */
export function gepaBlindRouteGate(blind, rows, ceiling) {
  const misses = shownMisses(blind.map((b, i) => ({ itemId: b.itemId, refVerdict: b.verdict, unresolved: b.status === 'unresolved',
    pred: rows[i].pred, failed: rows[i].failed }))).length;
  // Failure share over the RESOLVED blind rows (the rows a miss can be counted on).
  const resolved = blind.map((b, i) => (b.status === 'unresolved' ? null : rows[i])).filter(Boolean);
  return gepaRouteVerdict({ misses, failures: resolved.filter((r) => r.failed).length, items: resolved.length }, ceiling);
}

export function buildBlindManifest({ k, promptSha, routes, blindItems, aggregatesSha256, infraReruns = [], recallNonRegression = null, method = null }) {
  return { kind: 'l4-blind', series: k, createdAt: new Date().toISOString(), promptSha256: promptSha,
    ...(method ? { method } : {}),
    routes, blindItems, aggregatesSha256,
    ...(infraReruns.length ? { infraReruns: infraReruns.map(({ route, previousAnswered, reason }) => ({ route, previousAnswered, reason })) } : {}),
    ...(recallNonRegression ? { recallNonRegression: { baselineSeries: recallNonRegression.baselineSeries, tolerance: recallNonRegression.tolerance } } : {}),
    note: 'blind aggregates sealed in $CLASSIF_HOME/blind/ (owner only); S113 is golden-exposed and excluded from selection' };
}

export async function main(argv = process.argv.slice(2)) {
  const k = argv.includes('--series') ? argv[argv.indexOf('--series') + 1] : process.env.SERIES;
  if (!k) { process.stderr.write('classif-l4-blind: pass SERIES=<k>\n'); process.exit(2); }
  const deferred = argv.includes('--deferred') ? argv[argv.indexOf('--deferred') + 1].split(',').filter(Boolean) : [];
  // A GEPA series (series-<k>.json method gepa) is scored on the GEPA routes.
  const universe = seriesRouteUniverse(seriesMethod(k), EVAL_ROUTES, gepaSeriesRoutes(k));
  const routes = universe.filter((r) => !deferred.includes(r));
  const concurrency = Number(argv.includes('--concurrency') ? argv[argv.indexOf('--concurrency') + 1] : 2);
  // ChatGPT quota guard (codex seats share the weekly quota with the production detection).
  const quotaPause = parseQuotaPause(argv.includes('--codex-quota-pause') ? argv[argv.indexOf('--codex-quota-pause') + 1] : undefined);
  const quotaGuard = createQuotaGuard({ threshold: quotaPause, isCodex: isCodexSeat });
  const resumeCommand = `make classif-l4-blind SERIES=${k} CLASSIF_ROLE=test-executor${deferred.length ? ` DEFERRED=${deferred.join(',')}` : ''}${quotaPause !== CODEX_QUOTA_PAUSE_DEFAULT ? ` CODEX_QUOTA_PAUSE=${quotaPause}` : ''} ENV=preprod`;
  // Infrastructure re-run (fail closed): named routes only, each one an executed route.
  const rerunRoutes = argv.includes('--rerun-infra-failed')
    ? [...new Set(String(argv[argv.indexOf('--rerun-infra-failed') + 1] ?? '').split(',').filter(Boolean))] : [];
  if (argv.includes('--rerun-infra-failed') && !rerunRoutes.length) throw new BlindRerunRefused('not-a-route', '--rerun-infra-failed needs at least one route');
  for (const r of rerunRoutes) {
    if (!ROUTES[r] || !universe.includes(r)) throw new BlindRerunRefused('not-a-route', `${r} is not an evaluated route`);
    if (!routes.includes(r)) throw new BlindRerunRefused('not-a-route', `${r} is deferred in this run`);
  }
  const home = classifHome();
  // The blind run refuses a series whose tuning manifest or frozen prompt is missing,
  // uncommitted, or locally modified (Annex M M.5).
  const devManifestFile = path.join(classifDir(process.env), 'l4', 'manifests', `series-${k}-dev.json`);
  const promptRel = path.join('tools', 'classif', 'l4', 'prompts', `P${k}.md`);
  const devManifest = JSON.parse(readFileSync(devManifestFile, 'utf8'));
  const frozen = readFileSync(path.join(repoRoot(process.env), promptRel), 'utf8');
  const promptSha = sha256(frozen);
  if (devManifest.promptSha256 !== promptSha) throw new Error('blind run refused: series dev manifest prompt sha differs from the frozen prompt');
  // Review §11b: re-scan the frozen prompt on every run.
  assertNoVerbatim(frozen, home, { what: `prompt P${k}` });
  // Review §9 (M.5): the pre-registered series manifest (floors, ceiling, supports, sha)
  // is required in blind; the run carries its pass/fail/indeterminate verdicts privately.
  const seriesSpec = loadSeriesManifest(k);
  if (seriesSpec.promptSha256 !== promptSha) throw new Error('blind run refused: pre-registered series manifest prompt sha differs from the frozen prompt');
  // Review §9b: executed routes and frozen halves must match the pre-registered series
  // (plain split read — L2 already enforced committed).
  assertSeriesRoutes(seriesSpec, routes, k);
  const gepa = seriesSpec.method === GEPA_METHOD;
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
  const refManifest = JSON.parse(readFileSync(path.join(classifDir(process.env), 'l3', 'manifests', 'reference-d.json'), 'utf8'));
  // Executor opens the blind half (role + key enforced inside; access logged).
  const blindExpected = openBlindSet({ purpose: `l4-blind-s${k}`, expectPlainSha256: refManifest.hashes.blindPlain, home, env: process.env });
  const corpus = new Map(parseJsonlTolerant(readFileSync(path.join(home, 'l0', 'dev-items.jsonl'), 'utf8')).map((i) => [i.itemId, i]));
  const blind = blindExpected.map((r) => ({ ...r, input: corpus.get(r.itemId)?.input ?? null }));
  if (blind.some((r) => !r.input)) throw new Error('classif-l4-blind: blind row without frozen input');
  const codes = loadCodes();
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  const seatTmp = privateDir(path.join(home, 'l4', 'seat-tmp'));
  const outDir = privateDir(blindDir(home));
  // Recall non-regression (owner rule 06/11): blind baseline of the same routes, read from the
  // private aggregates of the baseline series (null when the series does not declare it).
  const recallBaseline = loadBlindRecallBaseline({ seriesSpec, outDir, home, routes, items: blind.length });
  // Infrastructure re-run eligibility, before the budget plan and any seat call: every
  // named route must qualify (typed refusal otherwise) and pass the guard's prompt checks
  // as if its allowance were already recorded. A refusal makes no seat call, writes no
  // re-run audit and archives nothing (only the audited blind-set open precedes it).
  const rerun = new Map();
  for (const route of rerunRoutes) {
    const a = assessInfraRerun({ home, outDir, k, promptSha, route, blindIds: blind.map((b) => b.itemId), callsLog });
    assertBlindRunAllowed({ promptFile: promptRel, promptSha256: promptSha, model: a.model, effort: a.effort, home, extraAllowance: a.resume ? 0 : 1 });
    rerun.set(route, a);
  }
  // Review §5 (D5): planned counts only non-cached items — blind + S113 caches deducted.
  const blindCachedCount = (route, itemId) => {
    const f = path.join(outDir, `blind-s${k}-${route}.${itemId}.json`);
    if (!existsSync(f)) return null;
    try {
      const c = JSON.parse(readFileSync(f, 'utf8'));
      if (c.series === String(k) && c.promptSha256 === promptSha && c.route === route && c.itemId === itemId) return c.row;
    } catch { /* re-run */ }
    return null;
  };
  let uncachedBlind = 0;
  for (const route of routes) {
    const { model, effort } = ROUTES[route];
    const routeFile = path.join(outDir, `series-${k}-${route}.json`);
    const done = readAudit(home).some((e) => e.action === 'blind-run' && e.promptSha256 === promptSha && e.model === model && e.effort === effort
      && String(e.purpose ?? '').includes(`l4-blind-s${k}`)) && existsSync(routeFile) && !rerun.has(route);
    if (done) continue;
    for (const item of blind) {
      if (!blindCachedCount(route, item.itemId)) uncachedBlind++;
    }
  }
  // S113: inputs per remaining route minus matching per-item caches. Review D3: the
  // plan uses the same isS113Done predicate as the skip (verified file + audit).
  // Review D1: the eval-dir hook is test-only (production refuses it).
  const evalDir = testOnlyEnv(process.env, 'CLASSIF_EVAL_DIR') ?? EVAL_DIR_DEFAULT;
  let uncachedS113 = 0;
  for (const route of routes) {
    if (isS113Done({ outDir, k, promptSha, route, evalDir })) continue;
    let cached = 0;
    for (const f of readdirSyncSafe(outDir)) {
      if (!f.startsWith(`s113-s${k}-${route}.`)) continue;
      try {
        const c = JSON.parse(readFileSync(path.join(outDir, f), 'utf8'));
        if (c.series === String(k) && c.promptSha256 === promptSha && c.route === route) cached++;
      } catch { /* re-run */ }
    }
    uncachedS113 += Math.max(0, 113 - cached);
  }
  budgetCheck(home, uncachedBlind + uncachedS113);

function readdirSyncSafe(dir) {
  try { return readdirSync(dir); } catch { return []; }
}
  // Review §8: skip finished routes (completed audit) so a crash never repays them; a
  // re-run blocked on route 1 no longer strands routes 2+.
  const blindDone = (model, effort) => readAudit(home).some((e) => e.action === 'blind-run' && e.promptSha256 === promptSha && e.model === model && e.effort === effort
    && String(e.purpose ?? '').includes(`l4-blind-s${k}`));
  // Seat-family parallelism: families run in parallel, routes inside one family run
  // sequentially with the existing per-route concurrency (per-seat limit unchanged).
  // Per-item caches and per-route files are written inside the route task, so a
  // family failure keeps the cached items of the other families on disk.
  const runBlindRoute = async (route) => {
    const { model, effort } = ROUTES[route];
    const routeFile = path.join(outDir, `series-${k}-${route}.json`);
    // Review N6: resumed aggregates must equal an uninterrupted run — withUnresolved and
    // verdict restored, prompt sha verified (stale prompt never reuses rows).
    const infra = rerun.get(route);
    if (!infra && blindDone(model, effort) && existsSync(routeFile)) {
      const prev = JSON.parse(readFileSync(routeFile, 'utf8'));
      if (prev.promptSha256 !== promptSha) throw new Error(`blind resume refused: ${routeFile} prompt sha differs (re-run with the frozen prompt)`);
      return { ...prev.stats, withUnresolved: prev.withUnresolved, failures: prev.failures, verdict: prev.verdict,
        ...(gepa ? { misses: prev.misses, failureShare: prev.failureShare } : {}) };
    }
    if (infra) {
      // Audited allowance first (the guard admits exactly one more blind-run per allowance),
      // then the previous route file is archived; an interrupted re-run resumes on the same
      // allowance and only archives a route file still in place.
      const archived = `series-${k}-${route}.infra-failed.${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      if (!infra.resume) {
        audit({ action: 'blind-rerun-infra', purpose: `l4-blind-s${k}`, promptSha256: promptSha, model, effort, route,
          previousAnswered: infra.previousAnswered, maxAnswered: infra.maxAnswered, reason: infra.reason, counts: infra.counts, archivedTo: archived },
        { home, env: process.env });
      }
      if (existsSync(routeFile)) {
        renameSync(routeFile, path.join(outDir, archived));
        chmodSync(path.join(outDir, archived), 0o600);
      }
    }
    // Review N7: guard before the start audit — a refused run leaves no started trace.
    assertBlindRunAllowed({ promptFile: promptRel, promptSha256: promptSha, model, effort, home });
    audit({ action: 'blind-run-started', purpose: `l4-blind-s${k}`, promptSha256: promptSha, model, effort, items: blind.length,
      ...(infra ? { infraRerun: true } : {}) }, { home, env: process.env });
    // Review §8: per-item cache keyed (series,promptSha,route,itemId), written on return.
    // Review §9: the predicted code is kept.
    const loadBlindCached = (itemId) => {
      const f = path.join(outDir, `blind-s${k}-${route}.${itemId}.json`);
      if (!existsSync(f)) return null;
      try {
        const c = JSON.parse(readFileSync(f, 'utf8'));
        if (c.series === String(k) && c.promptSha256 === promptSha && c.route === route && c.itemId === itemId) return c.row;
      } catch { /* re-run */ }
      return null;
    };
    const rows = await pool(blind.map((item) => async () => {
      const hit = loadBlindCached(item.itemId);
      if (hit) return hit;
      if (quotaGuard.blocks(route)) return null;
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: true, phase: `l4-blind-s${k}`, route, itemId: item.itemId });
      const r = await callSeat(route, devPrompt(frozen, item), { base: seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: `l4-blind-s${k}`, route, itemId: item.itemId,
        exitCode: r.code, latencyMs: r.latencyMs, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null, toolEvents: r.toolEvents ?? null, ...(r.toolEvents && r.toolKinds ? { toolKinds: r.toolKinds } : {}), ...quotaFields(r) });
      quotaGuard.observe(route, r.rateLimits);
      const parsed = parseSeatResult(r, codes);
      const row = { itemId: item.itemId, failed: parsed.failed, why: parsed.why ?? null,
        pred: parsed.failed ? null : { verdict: parsed.verdict, code: parsed.code } };
      // Review N4: failures are never cached — a transient seat failure is retried on
      // resume (new intent, counted) instead of becoming a permanent series failure.
      if (!row.failed) {
        writeFileSync(path.join(outDir, `blind-s${k}-${route}.${item.itemId}.json`),
          JSON.stringify({ series: String(k), promptSha256: promptSha, route, itemId: item.itemId, row }), { mode: 0o600 });
      }
      return row;
    }), concurrency);
    // Answered items are cached above; a paused codex route stops before its blind-run audit.
    if (quotaGuard.paused && isCodexSeat(route)) throw quotaGuard.error(resumeCommand);
    // Review §9a: indeterminate supports come from the pre-registered series manifest.
    const supports = seriesSpec.supports ?? {};
    const stats = shownStats(blind.map((b, i) => ({ ref: b.verdict, pred: rows[i].failed ? { failed: true } : rows[i].pred, unresolved: b.status === 'unresolved' })),
      { recallSupport: supports.recall ?? 30, precisionSupport: supports.precision ?? 30 });
    const statsWithUnresolved = shownStats(blind.map((b, i) => ({ ref: b.verdict, pred: rows[i].failed ? { failed: true } : rows[i].pred, unresolved: false })),
      { recallSupport: supports.recall ?? 30, precisionSupport: supports.precision ?? 30 });
    const failures = rows.filter((r) => r.failed).length;
    const gate = gepa ? gepaBlindRouteGate(blind, rows, seriesSpec.failureCeiling)
      : blindRouteVerdict({ stats, failures, items: rows.length }, seriesSpec, recallBaseline, route);
    writeFileSync(routeFile, JSON.stringify({ series: k, route, model, effort, promptSha256: promptSha, stats, withUnresolved: statsWithUnresolved, failures, ...gate }, null, 1), { mode: 0o600 });
    audit({ action: 'blind-run', purpose: `l4-blind-s${k}`, promptSha256: promptSha, model, effort, items: rows.length, failures,
      ...(infra ? { infraRerun: true } : {}) }, { home, env: process.env });
    return { ...stats, withUnresolved: statsWithUnresolved, failures, ...gate };
  };
  const sequential = argv.includes('--sequential');
  const perRoute = {};
  if (sequential) {
    for (const route of routes) perRoute[route] = await runBlindRoute(route);
  } else {
    const blindByRoute = await runFamiliesParallel(groupRoutesByFamily(routes), runBlindRoute);
    for (const route of routes) perRoute[route] = blindByRoute.get(route);
  }
  // S113 secondary: Steve's labels, flagged golden-exposed, diagnostic, outside selection.
  // Review N2/D3 + §11c: the shared isS113Done predicate (verified s113 file +
  // eval-run audit) skips before the guard, and the per-route guard runs BEFORE
  // opening the eval set. The eval dir honours CLASSIF_EVAL_DIR in test mode only.
  const s113Done = (route) => isS113Done({ outDir, k, promptSha, route, evalDir });
  // Pre-compute remaining S113 routes, guard them BEFORE opening (fail fast, no dangling open).
  const s113Remaining = [];
  for (const route of routes) {
    if (s113Done(route)) continue;
    const { model, effort } = ROUTES[route];
    assertEvalRunAllowed({ promptFile: promptRel, promptSha256: promptSha, model, effort, evalDir });
    s113Remaining.push(route);
  }
  const { inputs, expected } = s113Remaining.length ? openEvalSet({ purpose: `l4-s113-s${k}`, env: process.env, evalDir }) : { inputs: [], expected: [] };
  const expById = new Map(expected.map((e) => [e.evalId, e]));
  const s113 = {};
  // Restore skipped S113 aggregates so a resumed series keeps identical private aggregates.
  for (const route of routes) {
    if (!s113Remaining.includes(route)) {
      const s113File = path.join(outDir, `s113-series-${k}-${route}.json`);
      try {
        const prev = JSON.parse(readFileSync(s113File, 'utf8'));
        s113[route] = prev.s113;
        continue;
      } catch { /* fall through to re-run below (should not happen: done implies file) */ }
    }
  }
  const runS113Route = async (route) => {
    const { model, effort } = ROUTES[route];
    const s113File = path.join(outDir, `s113-series-${k}-${route}.json`);
    const loadS113Cached = (evalId) => {
      const f = path.join(outDir, `s113-s${k}-${route}.${evalId}.json`);
      if (!existsSync(f)) return null;
      try {
        const c = JSON.parse(readFileSync(f, 'utf8'));
        if (c.series === String(k) && c.promptSha256 === promptSha && c.route === route && c.evalId === evalId) return c.row;
      } catch { /* re-run */ }
      return null;
    };
    const rows = await pool(inputs.map((item) => async () => {
      const hit = loadS113Cached(item.evalId);
      if (hit) return hit;
      if (quotaGuard.blocks(route)) return null;
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: true, phase: `l4-s113-s${k}`, route, itemId: item.evalId });
      const r = await callSeat(route, devPrompt(frozen, item), { base: seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: `l4-s113-s${k}`, route, itemId: item.evalId,
        exitCode: r.code, latencyMs: r.latencyMs, toolEvents: r.toolEvents ?? null, ...(r.toolEvents && r.toolKinds ? { toolKinds: r.toolKinds } : {}), ...quotaFields(r) });
      quotaGuard.observe(route, r.rateLimits);
      const parsed = parseSeatResult(r, codes);
      const row = { failed: parsed.failed, pred: parsed.failed ? null : { verdict: parsed.verdict, code: parsed.code } };
      // Review N4: failures are never cached — retried on resume.
      if (!row.failed) {
        writeFileSync(path.join(outDir, `s113-s${k}-${route}.${item.evalId}.json`),
          JSON.stringify({ series: String(k), promptSha256: promptSha, route, evalId: item.evalId, row }), { mode: 0o600 });
      }
      return row;
    }), concurrency);
    if (quotaGuard.paused && isCodexSeat(route)) throw quotaGuard.error(resumeCommand);
    const exp = inputs.map((i) => expById.get(i.evalId));
    const s113supports = seriesSpec.supports ?? {};
    const s113stats = shownStats(inputs.map((item, i) => ({ ref: exp[i].verdict, pred: rows[i].failed ? { failed: true } : rows[i].pred, unresolved: false })),
      { recallSupport: s113supports.recall ?? 30, precisionSupport: s113supports.precision ?? 30 });
    const pRows = exp.map((e, i) => ({ e, r: rows[i] })).filter(({ e }) => e.verdict === 'pertinent');
    const masked = pRows.filter(({ r }) => r.failed || r.pred?.verdict === 'non_pertinent').length;
    const value = { ...s113stats, pertinentMasked: pertinentMasked(masked, pRows.length), flag: 'golden-exposed', selection: 'excluded (secondary diagnostic)' };
    writeFileSync(s113File, JSON.stringify({ series: k, route, promptSha256: promptSha, stats: s113stats, s113: value }, null, 1), { mode: 0o600 });
    auditEval({ action: 'eval-run', purpose: `l4-s113-s${k}`, promptSha256: promptSha, model, effort, items: rows.length }, { evalDir, env: process.env });
    return value;
  };
  if (sequential) {
    for (const route of s113Remaining) s113[route] = await runS113Route(route);
  } else {
    const s113ByRoute = await runFamiliesParallel(groupRoutesByFamily(s113Remaining), runS113Route);
    for (const route of s113Remaining) s113[route] = s113ByRoute.get(route);
  }
  // Review §1 (D3 adaptation ban): blind aggregates stay in $CLASSIF_HOME/blind/ (owner
  // only). The repo manifest and stdout carry NO scores — only the aggregates sha256.
  // Review D3: canonical key order, so a resumed restore at equal data hashes identically.
  // The non-regression gate is re-applied to every route (fresh or resumed) against the
  // baseline read at this run, so a resumed route never keeps a stale baseline verdict.
  if (recallBaseline) {
    for (const route of routes) {
      const e = perRoute[route];
      perRoute[route] = { ...e, ...blindRouteVerdict({ stats: e, failures: e.failures, items: blind.length }, seriesSpec, recallBaseline, route) };
    }
  }
  // GEPA series: the series verdict (every GEPA route passes) joins the private aggregates.
  const aggregates = { perRoute, s113, ...(gepa ? { gepa: { ...gepaSeriesVerdict(perRoute, seriesSpec.routes),
    rule: 'pass only when every GEPA route has 0 blind miss and a call failure share <= the ceiling; precision reported, no floor' } } : {}) };
  const aggregatesSha256 = sha256(stableStringify(aggregates));
  writeFileSync(path.join(outDir, `series-${k}-aggregates.json`), JSON.stringify({ series: k, promptSha256: promptSha, aggregatesSha256, ...aggregates }, null, 1), { mode: 0o600 });
  // Review §1: repo manifest + stdout carry NO scores (aggregates sha only).
  // Infra re-runs come from the audit, so a later resume keeps them in the manifest.
  const infraReruns = readAudit(home).filter((e) => e.action === 'blind-rerun-infra' && e.promptSha256 === promptSha
    && String(e.purpose ?? '').includes(`l4-blind-s${k}`) && routes.includes(e.route));
  const manifest = buildBlindManifest({ k, promptSha, routes, blindItems: blind.length, aggregatesSha256, infraReruns, recallNonRegression: recallBaseline,
    method: gepa ? GEPA_METHOD : null });
  mkdirSync(path.join(classifDir(process.env), 'l4', 'manifests'), { recursive: true });
  writeFileSync(path.join(classifDir(process.env), 'l4', 'manifests', `series-${k}-blind.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'blind.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-blind: ${err.stack}\n`); process.exit(1); });
}
