#!/usr/bin/env node
// make classif-l2-pass PASS=<n> [MODE=independent|reconcile] [GUIDE=G0] ENV=preprod
// One annotation pass of the 3 max-effort annotators (plan §B-L2) over the dev items (384 signals in
// lots of 10 grouped by city, 120 PVs one per call), or over the pass's todo list for passes ≥ 2.
// Each call: isolated seat (run-seat.mjs) → compact JSON → Engram extraction → engram profile
// validate-extraction (+ radar-side registry record check) → per-item validity. Resumable: a lot
// already done for (pass, annotator) is skipped. Dev items only: the sealed evaluation set is never read.
import path from 'node:path';
import process from 'node:process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { callSeat } from '../run-seat.mjs';
import { sha256 } from '../lib/render.mjs';
import { classifHome, privateDir } from '../lib/paths.mjs';
import { PROFILE_DIR, validateExtraction } from '../lib/engram.mjs';
import { buildPrompt, itemValidity, loadPack, parseAnswers, toExtraction } from './annotation.mjs';

export const ANNOTATORS = ['muse-wonder-max', 'gemini-4-argon-high', 'opus-5.5-max'];
export const LOT_SIZE = 10;

export function loadDevItems(home) {
  return readFileSync(path.join(home, 'l0', 'dev-items.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

export function loadCodes() {
  const rows = readFileSync(path.join(PROFILE_DIR, 'registries', 'reason_codes.csv'), 'utf8').trim().split('\n').slice(1);
  return new Map(rows.map((l) => l.split(',')));
}

/** Signals: grouped by city (sorted), chunks of 10. PVs: one per lot. */
export function makeLots(items) {
  const sig = items.filter((i) => i.kind === 'signal').sort((a, b) => (a.anchor.citySlug + a.itemId < b.anchor.citySlug + b.itemId ? -1 : 1));
  const lots = [];
  for (let i = 0; i < sig.length; i += LOT_SIZE) lots.push({ lotId: `s${String(lots.length + 1).padStart(3, '0')}`, items: sig.slice(i, i + LOT_SIZE) });
  for (const pv of items.filter((i) => i.kind === 'pv')) lots.push({ lotId: `p-${pv.itemId}`, items: [pv] });
  return lots;
}

async function pool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; await tasks[k](); } }));
}

export async function runPass({ pass, mode = 'independent', guide = 'G0', annotators = ANNOTATORS, todo = null, context = new Map(), concurrency = 4, onlyLots = null, home = classifHome(), log = (s) => process.stdout.write(`${s}\n`) }) {
  const all = loadDevItems(home);
  const items = todo ? all.filter((i) => todo.has(i.itemId)) : all;
  const lots = makeLots(items).filter((l) => !onlyLots || onlyLots.includes(l.lotId));
  const codes = loadCodes();
  const pack = loadPack(path.join(home, 'l1', 'pack'), guide);
  const work = path.join(home, 'l1', 'engram-work');
  const profilePrompt = readFileSync(path.join(work, 'profile-prompt.md'), 'utf8');
  const passDir = path.join(home, 'l2', `pass${pass}`);
  const seatTmp = privateDir(path.join(home, 'l2', 'seat-tmp'));
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  const started = Date.now();
  const tasks = [];
  for (const annotator of annotators) {
    const dir = path.join(passDir, annotator);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    mkdirSync(path.join(work, 'runs', `pass${pass}`, annotator), { recursive: true });
    for (const lot of lots) {
      const out = path.join(dir, `${lot.lotId}.json`);
      if (existsSync(out)) continue;
      tasks.push({ annotator, lot, out });
    }
  }
  // One pool per annotator: at most `concurrency` simultaneous calls per seat (machine load).
  let done = 0;
  const work1 = async ({ annotator, lot, out }) => {
    const prompt = buildPrompt({ profilePrompt, pack, items: lot.items, mode, context: context.get(annotator) ?? new Map() });
    let r = null;
    let pairs = [];
    let attempts = 0;
    // Resume state: every seat answer is saved (raw/) as soon as it returns, keyed by prompt sha256 and
    // attempt; a restart reuses a saved answer instead of paying the call again.
    const rawDir = path.join(passDir, 'raw', annotator);
    mkdirSync(rawDir, { recursive: true, mode: 0o700 });
    const promptSha = sha256(prompt);
    for (attempts = 1; attempts <= 3; attempts++) {
      const rawFile = path.join(rawDir, `${lot.lotId}.${promptSha.slice(0, 16)}.a${attempts}.json`);
      let reused = false;
      if (existsSync(rawFile)) { r = JSON.parse(readFileSync(rawFile, 'utf8')); reused = true; }
      else {
        r = await callSeat(annotator, prompt, { base: seatTmp, timeoutMs: 3600000 });
        writeFileSync(rawFile, JSON.stringify(r), { mode: 0o600 });
      }
      pairs = parseAnswers(r.text, lot.items);
      const answered = pairs.filter((p) => p.answer).length;
      appendFileSync(callsLog, `${JSON.stringify({ at: new Date().toISOString(), pass, mode, guide, annotator, lotId: lot.lotId, items: lot.items.length, attempt: attempts,
        exitCode: r.code, latencyMs: r.latencyMs, reused, answered, toolEvents: r.toolEvents ?? null, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null })}\n`);
      if (r.code === 0 && answered > 0 && !(r.toolEvents > 0)) break;
    }
    if (r.toolEvents > 0) pairs = pairs.map((p) => ({ ...p, answer: null }));
    const extraction = toExtraction({ annotator, pass, guideVersion: pack.guideVersion, pairs, codes });
    const rel = path.join('runs', `pass${pass}`, annotator, `${lot.lotId}.json`);
    writeFileSync(path.join(work, rel), JSON.stringify(extraction), { mode: 0o600 });
    const validation = extraction.nodes.length ? validateExtraction(work, rel) : { valid: false, issues: [] };
    // Fail closed: if Engram itself could not run, every item is an execution failure until
    // `make classif-l2-revalidate` re-checks the saved extraction (no seat call).
    const engramDown = (validation.issues ?? []).some((i) => i.code === 'engram_failed');
    const validity = engramDown ? pairs.map(({ item }) => ({ itemId: item.itemId, valid: false, issues: ['engram_failed'] })) : itemValidity(extraction, validation, pairs, codes);
    const annotations = pairs.map(({ item, answer }, i) => ({
      itemId: item.itemId, kind: item.kind, valid: validity[i].valid, issues: validity[i].issues,
      code: answer ? String(answer.code ?? '') : null, verdict: answer ? codes.get(String(answer.code ?? '')) ?? null : null,
      ambiguous: answer ? answer.ambiguous === true : null, cause: answer?.ambiguity_cause ?? null, quote: answer?.quote ?? null,
      reason: answer?.reason ?? null, changed: answer?.changed ?? null,
      quoteFound: extraction.nodes.find((n) => n.id === `annotation:${annotator}:p${pass}:${item.itemId}`)?.quote_found ?? null,
    }));
    writeFileSync(out, JSON.stringify({ pass, mode, guide, annotator, lotId: lot.lotId, promptSha256: sha256(prompt), packSha256: pack.sha256, attempts,
      exitCode: r.code, latencyMs: r.latencyMs, usage: r.usage ?? null, engramValid: validation.valid ?? false, engramIssues: (validation.issues ?? []).length,
      engramIssueCodes: [...new Set((validation.issues ?? []).map((x) => x.code))], engramChecked: !engramDown, annotations }, null, 1), { mode: 0o600 });
    done++;
    if (done % 10 === 0 || done === tasks.length) log(`[pass ${pass}] ${done}/${tasks.length} calls done (${Math.round((Date.now() - started) / 60000)} min)`);
  };
  await Promise.all(annotators.map((a) => pool(tasks.filter((t) => t.annotator === a).map((t) => () => work1(t)), concurrency)));
  return { pass, calls: tasks.length, minutes: (Date.now() - started) / 60000 };
}

/** Reads every annotation of a pass: Map<annotator, Map<itemId, annotation>>. */
export function readPass(home, pass, annotators = ANNOTATORS) {
  const out = new Map();
  for (const a of annotators) {
    const dir = path.join(home, 'l2', `pass${pass}`, a);
    const m = new Map();
    if (existsSync(dir)) {
      for (const f of readdirSyncSafe(dir)) {
        const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        for (const an of j.annotations) m.set(an.itemId, { ...an, pass, guide: j.guide });
      }
    }
    out.set(a, m);
  }
  return out;
}

function readdirSyncSafe(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'run.mjs'))) {
  const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
  const pass = Number(arg('--pass', '1'));
  const mode = arg('--mode', 'independent');
  const guide = arg('--guide', 'G0');
  const home = classifHome();
  const todoFile = path.join(home, 'l2', `pass${pass}`, 'todo.json');
  const ctxFile = path.join(home, 'l2', `pass${pass}`, 'context.json');
  const todo = pass > 1 && existsSync(todoFile) ? new Set(JSON.parse(readFileSync(todoFile, 'utf8')).items) : null;
  if (pass > 1 && !todo) { process.stderr.write(`classif-l2-pass: ${todoFile} missing (run make classif-l2-converge first)\n`); process.exit(2); }
  const context = existsSync(ctxFile) ? new Map(Object.entries(JSON.parse(readFileSync(ctxFile, 'utf8'))).map(([a, m]) => [a, new Map(Object.entries(m))])) : new Map();
  runPass({ pass, mode, guide, todo, context, concurrency: Number(arg('--concurrency', '4')), home, onlyLots: arg('--lots', '') ? arg('--lots', '').split(',') : null })
    .then((r) => process.stdout.write(`${JSON.stringify(r)}\n`))
    .catch((err) => { process.stderr.write(`classif-l2-pass: ${err.stack}\n`); process.exit(1); });
}
