#!/usr/bin/env node
// make classif-l4-blind SERIES=<k> ENV=preprod — blind-half scoring (plan v3 D3), EXECUTOR ONLY.
//
// One shot per (prompt sha, route) on the blind half, opened with CLASSIF_BLIND_KEY under the
// test-executor role (lib/blind.mjs: role, key, plaintext hash, access log, one run per tuple,
// per-item listing refused). Aggregates are written to $CLASSIF_HOME/blind/ ONLY; the repo
// manifest carries metrics (Annex M), never per-item data. Nothing from the blind half ever
// enters an optimiser input. S113 runs as a SECONDARY measure (flagged golden-exposed,
// diagnostic, outside selection).
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROUTES, callSeat } from '../run-seat.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, REPO, classifHome, privateDir } from '../lib/paths.mjs';
import { EVAL_ROUTES, devPrompt, parseDevAnswer } from './dev.mjs';
import { pertinentMasked, shownStats } from './metrics.mjs';
import { check as budgetCheck } from '../lib/budget.mjs';
import { loadCodes } from '../l2/run.mjs';
import { assertBlindRunAllowed, audit, blindDir, openBlindSet } from '../lib/blind.mjs';
import { openEvalSet } from '../guard/evalset.mjs';

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
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
  const refManifest = JSON.parse(readFileSync(path.join(CLASSIF_DIR, 'l3', 'manifests', 'reference-d.json'), 'utf8'));
  // Executor opens the blind half (role + key enforced inside; access logged).
  const blindExpected = openBlindSet({ purpose: `l4-blind-s${k}`, expectPlainSha256: refManifest.hashes.blindPlain, home, env: process.env });
  const corpus = new Map(parseJsonlTolerant(readFileSync(path.join(home, 'l0', 'dev-items.jsonl'), 'utf8')).map((i) => [i.itemId, i]));
  const blind = blindExpected.map((r) => ({ ...r, input: corpus.get(r.itemId)?.input ?? null }));
  if (blind.some((r) => !r.input)) throw new Error('classif-l4-blind: blind row without frozen input');
  const codes = loadCodes();
  budgetCheck(home, blind.length * routes.length + 113 * routes.length);
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  const seatTmp = privateDir(path.join(home, 'l4', 'seat-tmp'));
  const outDir = privateDir(blindDir(home));
  const perRoute = {};
  for (const route of routes) {
    const { model, effort } = ROUTES[route];
    assertBlindRunAllowed({ promptFile: promptRel, promptSha256: promptSha, model, effort, home });
    const rows = await pool(blind.map((item) => async () => {
      const r = await callSeat(route, devPrompt(frozen, item), { base: seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), phase: `l4-blind-s${k}`, route, itemId: item.itemId,
        exitCode: r.code, latencyMs: r.latencyMs, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null });
      const parsed = r.code === 0 ? parseDevAnswer(r.text, codes) : { verdict: null, code: null, failed: true, why: `exit-${r.code}` };
      return { itemId: item.itemId, failed: parsed.failed, why: parsed.why ?? null,
        pred: parsed.failed ? null : { verdict: parsed.verdict } };
    }), concurrency);
    const stats = shownStats(blind.map((b, i) => ({ ref: b.verdict, pred: rows[i].failed ? { failed: true } : rows[i].pred, unresolved: b.status === 'unresolved' })));
    const failures = rows.filter((r) => r.failed).length;
    writeFileSync(path.join(outDir, `series-${k}-${route}.json`), JSON.stringify({ series: k, route, model, effort, promptSha256: promptSha, stats, failures }, null, 1), { mode: 0o600 });
    audit({ action: 'blind-run', purpose: `l4-blind-s${k}`, promptSha256: promptSha, model, effort, items: rows.length, failures }, { home, env: process.env });
    perRoute[route] = { ...stats, failures };
  }
  // S113 secondary: Steve's labels, flagged golden-exposed, diagnostic, outside selection.
  const { inputs, expected } = openEvalSet({ purpose: `l4-s113-s${k}`, env: process.env });
  const expById = new Map(expected.map((e) => [e.evalId, e]));
  const s113 = {};
  for (const route of routes) {
    const rows = await pool(inputs.map((item) => async () => {
      const r = await callSeat(route, devPrompt(frozen, item), { base: seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), phase: `l4-s113-s${k}`, route, itemId: item.evalId,
        exitCode: r.code, latencyMs: r.latencyMs });
      const parsed = r.code === 0 ? parseDevAnswer(r.text, codes) : { verdict: null, code: null, failed: true, why: `exit-${r.code}` };
      return { failed: parsed.failed, pred: parsed.failed ? null : { verdict: parsed.verdict } };
    }), concurrency);
    const exp = inputs.map((i) => expById.get(i.evalId));
    const stats = shownStats(inputs.map((item, i) => ({ ref: exp[i].verdict, pred: rows[i].failed ? { failed: true } : rows[i].pred, unresolved: false })));
    const pRows = exp.map((e, i) => ({ e, r: rows[i] })).filter(({ e }) => e.verdict === 'pertinent');
    const masked = pRows.filter(({ r }) => r.failed || r.pred?.verdict === 'non_pertinent').length;
    s113[route] = { ...stats, pertinentMasked: pertinentMasked(masked, pRows.length), flag: 'golden-exposed', selection: 'excluded (secondary diagnostic)' };
    writeFileSync(path.join(outDir, `s113-series-${k}-${route}.json`), JSON.stringify({ series: k, route, stats, s113: s113[route] }, null, 1), { mode: 0o600 });
  }
  const manifest = { kind: 'l4-blind', series: k, createdAt: new Date().toISOString(), promptSha256: promptSha,
    routes, deferred, blindItems: blind.length, perRoute, s113,
    note: 'blind aggregates sealed in $CLASSIF_HOME/blind/ (owner only); S113 is golden-exposed and excluded from selection' };
  mkdirSync(path.join(CLASSIF_DIR, 'l4', 'manifests'), { recursive: true });
  writeFileSync(path.join(CLASSIF_DIR, 'l4', 'manifests', `series-${k}-blind.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'blind.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-blind: ${err.stack}\n`); process.exit(1); });
}
