#!/usr/bin/env node
// make classif-l4-blind SERIES=<k> ENV=preprod — blind-half scoring (plan v3 D3), EXECUTOR ONLY.
//
// One shot per (prompt sha, route) on the blind half, opened with CLASSIF_BLIND_KEY under the
// test-executor role (lib/blind.mjs: role, key, plaintext hash, access log, one run per tuple,
// per-item listing refused). Aggregates stay in $CLASSIF_HOME/blind/ (owner only); the repo
// manifest and stdout carry only the aggregates sha256 (D3 adaptation ban, review §1).
// Nothing from the blind half ever enters an optimiser input. S113 runs as a SECONDARY
// measure (flagged golden-exposed, diagnostic, outside selection).
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { ROUTES, callSeat } from '../run-seat.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, REPO, classifHome, privateDir } from '../lib/paths.mjs';
import { EVAL_ROUTES, devPrompt, parseDevAnswer } from './dev.mjs';
import { pertinentMasked, seriesVerdict, shownStats } from './metrics.mjs';
import { check as budgetCheck } from '../lib/budget.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';
import { loadCodes } from '../l2/run.mjs';
import { assertBlindRunAllowed, audit, blindDir, openBlindSet, readAudit } from '../lib/blind.mjs';
import { assertEvalRunAllowed, audit as auditEval, openEvalSet } from '../guard/evalset.mjs';
import { assertSeriesHalves, assertSeriesRoutes, loadSeriesManifest } from './series.mjs';

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
export function buildBlindManifest({ k, promptSha, routes, blindItems, aggregatesSha256 }) {
  return { kind: 'l4-blind', series: k, createdAt: new Date().toISOString(), promptSha256: promptSha,
    routes, blindItems, aggregatesSha256,
    note: 'blind aggregates sealed in $CLASSIF_HOME/blind/ (owner only); S113 is golden-exposed and excluded from selection' };
}

export async function main(argv = process.argv.slice(2)) {
  const k = argv.includes('--series') ? argv[argv.indexOf('--series') + 1] : process.env.SERIES;
  if (!k) { process.stderr.write('classif-l4-blind: pass SERIES=<k>\n'); process.exit(2); }
  const deferred = argv.includes('--deferred') ? argv[argv.indexOf('--deferred') + 1].split(',').filter(Boolean) : [];
  const routes = EVAL_ROUTES.filter((r) => !deferred.includes(r));
  const concurrency = Number(argv.includes('--concurrency') ? argv[argv.indexOf('--concurrency') + 1] : 2);
  const home = classifHome();
  // The blind run refuses a series whose tuning manifest or frozen prompt is missing,
  // uncommitted, or locally modified (Annex M M.5).
  const devManifestFile = path.join(CLASSIF_DIR, 'l4', 'manifests', `series-${k}-dev.json`);
  const promptRel = path.join('tools', 'classif', 'l4', 'prompts', `P${k}.md`);
  const devManifest = JSON.parse(readFileSync(devManifestFile, 'utf8'));
  const frozen = readFileSync(path.join(REPO, promptRel), 'utf8');
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
  try {
    const splitFile = path.join(CLASSIF_DIR, 'l3', 'manifests', 'split.json');
    if (existsSync(splitFile)) {
      const split = JSON.parse(readFileSync(splitFile, 'utf8'));
      if (split.sha256) assertSeriesHalves(seriesSpec, k, split.sha256);
    }
  } catch (e) {
    if (/halves|refused/.test(e.message)) throw e;
    throw e;
  }
  const refManifest = JSON.parse(readFileSync(path.join(CLASSIF_DIR, 'l3', 'manifests', 'reference-d.json'), 'utf8'));
  // Executor opens the blind half (role + key enforced inside; access logged).
  const blindExpected = openBlindSet({ purpose: `l4-blind-s${k}`, expectPlainSha256: refManifest.hashes.blindPlain, home, env: process.env });
  const corpus = new Map(parseJsonlTolerant(readFileSync(path.join(home, 'l0', 'dev-items.jsonl'), 'utf8')).map((i) => [i.itemId, i]));
  const blind = blindExpected.map((r) => ({ ...r, input: corpus.get(r.itemId)?.input ?? null }));
  if (blind.some((r) => !r.input)) throw new Error('classif-l4-blind: blind row without frozen input');
  const codes = loadCodes();
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  const seatTmp = privateDir(path.join(home, 'l4', 'seat-tmp'));
  const outDir = privateDir(blindDir(home));
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
      && String(e.purpose ?? '').includes(`l4-blind-s${k}`)) && existsSync(routeFile);
    if (done) continue;
    for (const item of blind) {
      if (!blindCachedCount(route, item.itemId)) uncachedBlind++;
    }
  }
  // S113: 113 inputs per remaining route minus matching per-item caches.
  let uncachedS113 = 0;
  for (const route of routes) {
    const s113File = path.join(outDir, `s113-series-${k}-${route}.json`);
    if (existsSync(s113File)) continue;
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
  const perRoute = {};
  for (const route of routes) {
    const { model, effort } = ROUTES[route];
    const routeFile = path.join(outDir, `series-${k}-${route}.json`);
    // Review N6: resumed aggregates must equal an uninterrupted run — withUnresolved and
    // verdict restored, prompt sha verified (stale prompt never reuses rows).
    if (blindDone(model, effort) && existsSync(routeFile)) {
      const prev = JSON.parse(readFileSync(routeFile, 'utf8'));
      if (prev.promptSha256 !== promptSha) throw new Error(`blind resume refused: ${routeFile} prompt sha differs (re-run with the frozen prompt)`);
      perRoute[route] = { ...prev.stats, withUnresolved: prev.withUnresolved, failures: prev.failures, verdict: prev.verdict };
      continue;
    }
    // Review N7: guard before the start audit — a refused run leaves no started trace.
    assertBlindRunAllowed({ promptFile: promptRel, promptSha256: promptSha, model, effort, home });
    audit({ action: 'blind-run-started', purpose: `l4-blind-s${k}`, promptSha256: promptSha, model, effort, items: blind.length }, { home, env: process.env });
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
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: true, phase: `l4-blind-s${k}`, route, itemId: item.itemId });
      const r = await callSeat(route, devPrompt(frozen, item), { base: seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: `l4-blind-s${k}`, route, itemId: item.itemId,
        exitCode: r.code, latencyMs: r.latencyMs, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null });
      const parsed = r.code === 0 ? parseDevAnswer(r.text, codes) : { verdict: null, code: null, failed: true, why: `exit-${r.code}` };
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
    // Review §9a: indeterminate supports come from the pre-registered series manifest.
    const supports = seriesSpec.supports ?? {};
    const stats = shownStats(blind.map((b, i) => ({ ref: b.verdict, pred: rows[i].failed ? { failed: true } : rows[i].pred, unresolved: b.status === 'unresolved' })),
      { recallSupport: supports.recall ?? 30, precisionSupport: supports.precision ?? 30 });
    const statsWithUnresolved = shownStats(blind.map((b, i) => ({ ref: b.verdict, pred: rows[i].failed ? { failed: true } : rows[i].pred, unresolved: false })),
      { recallSupport: supports.recall ?? 30, precisionSupport: supports.precision ?? 30 });
    const failures = rows.filter((r) => r.failed).length;
    const verdict = seriesVerdict({ stats, failures, items: rows.length },
      { recallFloor: seriesSpec.floors?.recall ?? 0, precisionFloor: seriesSpec.floors?.precision ?? 0, failureCeiling: seriesSpec.failureCeiling ?? 0.1 });
    writeFileSync(routeFile, JSON.stringify({ series: k, route, model, effort, promptSha256: promptSha, stats, withUnresolved: statsWithUnresolved, failures, verdict }, null, 1), { mode: 0o600 });
    audit({ action: 'blind-run', purpose: `l4-blind-s${k}`, promptSha256: promptSha, model, effort, items: rows.length, failures }, { home, env: process.env });
    perRoute[route] = { ...stats, withUnresolved: statsWithUnresolved, failures, verdict };
  }
  // S113 secondary: Steve's labels, flagged golden-exposed, diagnostic, outside selection.
  // Review N2 + §11c: evalDone symmetric to blindDone (verified s113 file + eval-run audit
  // skips before the guard), and the per-route guard runs BEFORE opening the eval set.
  // The eval dir honours CLASSIF_EVAL_DIR (tests) else the default sealed set.
  const { EVAL_DIR_DEFAULT } = await import('../lib/paths.mjs');
  const { readAudit: readEvalAudit } = await import('../guard/evalset.mjs');
  const evalDir = process.env.CLASSIF_EVAL_DIR ?? EVAL_DIR_DEFAULT;
  const isS113Done = (route) => {
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
  };
  // Pre-compute remaining S113 routes, guard them BEFORE opening (fail fast, no dangling open).
  const s113Remaining = [];
  for (const route of routes) {
    if (isS113Done(route)) continue;
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
  for (const route of s113Remaining) {
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
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: true, phase: `l4-s113-s${k}`, route, itemId: item.evalId });
      const r = await callSeat(route, devPrompt(frozen, item), { base: seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: `l4-s113-s${k}`, route, itemId: item.evalId,
        exitCode: r.code, latencyMs: r.latencyMs });
      const parsed = r.code === 0 ? parseDevAnswer(r.text, codes) : { verdict: null, code: null, failed: true, why: `exit-${r.code}` };
      const row = { failed: parsed.failed, pred: parsed.failed ? null : { verdict: parsed.verdict, code: parsed.code } };
      // Review N4: failures are never cached — retried on resume.
      if (!row.failed) {
        writeFileSync(path.join(outDir, `s113-s${k}-${route}.${item.evalId}.json`),
          JSON.stringify({ series: String(k), promptSha256: promptSha, route, evalId: item.evalId, row }), { mode: 0o600 });
      }
      return row;
    }), concurrency);
    const exp = inputs.map((i) => expById.get(i.evalId));
    const s113supports = seriesSpec.supports ?? {};
    const s113stats = shownStats(inputs.map((item, i) => ({ ref: exp[i].verdict, pred: rows[i].failed ? { failed: true } : rows[i].pred, unresolved: false })),
      { recallSupport: s113supports.recall ?? 30, precisionSupport: s113supports.precision ?? 30 });
    const pRows = exp.map((e, i) => ({ e, r: rows[i] })).filter(({ e }) => e.verdict === 'pertinent');
    const masked = pRows.filter(({ r }) => r.failed || r.pred?.verdict === 'non_pertinent').length;
    s113[route] = { ...s113stats, pertinentMasked: pertinentMasked(masked, pRows.length), flag: 'golden-exposed', selection: 'excluded (secondary diagnostic)' };
    writeFileSync(s113File, JSON.stringify({ series: k, route, promptSha256: promptSha, stats: s113stats, s113: s113[route] }, null, 1), { mode: 0o600 });
    auditEval({ action: 'eval-run', purpose: `l4-s113-s${k}`, promptSha256: promptSha, model, effort, items: rows.length }, { evalDir, env: process.env });
  }
  // Review §1 (D3 adaptation ban): blind aggregates stay in $CLASSIF_HOME/blind/ (owner
  // only). The repo manifest and stdout carry NO scores — only the aggregates sha256.
  const aggregates = { perRoute, s113 };
  const aggregatesSha256 = sha256(JSON.stringify(aggregates));
  writeFileSync(path.join(outDir, `series-${k}-aggregates.json`), JSON.stringify({ series: k, promptSha256: promptSha, aggregatesSha256, ...aggregates }, null, 1), { mode: 0o600 });
  // Review §1: repo manifest + stdout carry NO scores (aggregates sha only).
  const manifest = buildBlindManifest({ k, promptSha, routes, blindItems: blind.length, aggregatesSha256 });
  mkdirSync(path.join(CLASSIF_DIR, 'l4', 'manifests'), { recursive: true });
  writeFileSync(path.join(CLASSIF_DIR, 'l4', 'manifests', `series-${k}-blind.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'blind.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-blind: ${err.stack}\n`); process.exit(1); });
}
