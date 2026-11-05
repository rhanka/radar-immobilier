#!/usr/bin/env node
// make classif-l2-pass PASS=<n> [MODE=independent|reconcile] [GUIDE=G0] ENV=preprod
// One annotation pass of the 3 max-effort annotators (plan §B-L2) over the dev items (384 signals in
// lots of 10 grouped by city, 120 PVs one per call), or over the pass's todo list for passes ≥ 2.
// Each call: isolated seat (run-seat.mjs) → compact JSON → Engram extraction → engram profile
// validate-extraction (+ radar-side registry record check) → per-item validity. Resumable: a lot
// already done for (pass, annotator) is skipped. Dev items only: the sealed evaluation set is never read.
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { callSeat } from '../run-seat.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/render.mjs';
import { classifDir, repoRoot, testOnlyEnv, classifHome, privateDir } from '../lib/paths.mjs';
import { check as checkBudget } from '../lib/budget.mjs';
import { PROFILE_DIR, validateExtraction } from '../lib/engram.mjs';
import { spawnSync } from 'node:child_process';
import { buildPrompt, itemValidity, loadPack, parseAnswers, toExtraction } from './annotation.mjs';
import { loadGoldenPack } from './golden-pack.mjs';
import { assertFinalGuide } from '../lib/freeze.mjs';
import { sealedFile } from '../lib/blind.mjs';

// Plan v3 (owner decision 04/11): triple blind annotation = pass-1 votes of muse-wonder-max and
// opus-5.5-max (reused) + a NEW independent blind pass 1 of astra-max on the 504 items (same
// prompt, guide G0, same lots). Gemini 4 Argon leaves the annotator trio: its pass-1 votes stay
// archived on disk (pass1/gemini-4-argon-high/) and are excluded from convergence. Argon remains
// an evaluated route in L4 once its seat quota is back.
export const ANNOTATORS = ['muse-wonder-max', 'astra-max', 'opus-5.5-max'];
export const ARCHIVED_ANNOTATORS = ['gemini-4-argon-high'];
export const LOT_SIZE = 10;

/** Atomic file write: temp file in the same directory, then rename (a kill mid-write
    never leaves a truncated final file for resume to trust). */
export function atomicWrite(file, data, opts) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data, opts);
  renameSync(tmp, file);
}

/**
 * Fail-closed seat exit policy (explicit, logged by the caller): only a clean seat
 * exit (code 0) yields admissible votes. A non-zero exit — or a kill (code null) —
 * nulls every answer, so the lot becomes an execution failure (a missing vote in
 * convergence), never a fabricated majority.
 */
export function applyExitPolicy(pairs, r) {
  const exitAdmissible = r.code === 0;
  return { exitAdmissible, pairs: exitAdmissible ? pairs : pairs.map((p) => ({ ...p, answer: null })) };
}

/** Sync committed-split guard for the CLI (same rule as l3/split requireCommittedSplit,
    inlined to avoid the run→split→run cycle at top-level await).
    Review D1/D2: hermetic tests redirect via CLASSIF_REPO in test mode only. */
function requireCommittedSplitSync(splitFile = null, repo = null) {
  const env = process.env;
  const file = splitFile ?? path.join(classifDir(env), 'l3', 'manifests', 'split.json');
  const root = repo ?? repoRoot(env);
  if (!existsSync(file)) throw new Error(`split refused: ${file} absent (run make classif-l3b-split first)`);
  const rel = path.relative(root, file);
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`split refused: ${rel} is not committed (commit the draw before any pass ≥ 2)`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`split refused: ${rel} differs from the committed version (commit before any pass ≥ 2)`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Test-only quota-wait override, in milliseconds (review D1: production refuses it). */
export function testQuotaWaitMs(env = process.env) {
  const v = testOnlyEnv(env, 'CLASSIF_TEST_QUOTA_WAIT_MS');
  return v === undefined ? undefined : Number(v);
}

/** Milliseconds to wait when the seat answered a quota denial ("Resets in 10m57s"), else null. */
export function quotaWaitMs(r) {
  const msg = `${r?.error ?? ''} ${r?.stderrTail ?? ''} ${r?.code !== 0 ? r?.text ?? '' : ''}`;
  if (!/quota reached|quota exceeded|RESOURCE_EXHAUSTED|rate limit|usage limit/i.test(msg)) return null;
  const m = /Resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i.exec(msg);
  const ms = m ? ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000 : 15 * 60000;
  return Math.min(ms, 6 * 3600000) + 30000;
}

/**
 * Expected identity of the frozen dev corpus: the committed draw manifest, unless the home
 * carries its own expectations (synthetic test fixtures only — never in the real home).
 * The frozen corpus is checked by count AND manifest hash: a truncated write (killed draw)
 * must fail loudly instead of silently feeding an incomplete corpus to the next step.
 */
export function devCorpusExpectations(home) {
  const sidecar = path.join(home, 'l0', 'dev-items.expect.json');
  if (existsSync(sidecar)) {
    const e = JSON.parse(readFileSync(sidecar, 'utf8'));
    return { source: sidecar, count: e.count, sha256: e.sha256 };
  }
  const m = JSON.parse(readFileSync(path.join(classifDir(process.env), 'l0', 'manifests', 'draw-manifest.json'), 'utf8'));
  return { source: 'tools/classif/l0/manifests/draw-manifest.json', count: m.devItems, sha256: m.devItemsSha256 };
}

export function loadDevItems(home) {
  const file = path.join(home, 'l0', 'dev-items.jsonl');
  const raw = readFileSync(file, 'utf8');
  const exp = devCorpusExpectations(home);
  if (sha256(raw) !== exp.sha256) throw new Error(`frozen corpus hash mismatch in ${file} (expected ${exp.sha256} from ${exp.source}): refusing a possibly truncated corpus`);
  const records = parseJsonlTolerant(raw);
  if (records.length !== exp.count) throw new Error(`frozen corpus count ${records.length} != ${exp.count} in ${file} (from ${exp.source}): refusing a possibly truncated corpus`);
  if (!records.length) throw new Error(`no dev items in ${file}`);
  return records;
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

export async function runPass({ pass, mode = 'independent', guide = 'G0', annotators = ANNOTATORS, todo = null, context = new Map(), concurrency = 4, onlyLots = null, phase = null, goldenPack = null, goldenRows = null, home = classifHome(), log = (s) => process.stdout.write(`${s}\n`) }) {
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
  if (mode === 'crossreview' && !goldenPack) throw new Error(`pass ${pass}: crossreview mode requires the golden pack (run make classif-l2-golden-pack ENV=preprod first)`);
  // Review §5 (D5): central pre-call control — up to 3 paid attempts per remaining lot per
  // active annotator (cache deducted: tasks already exclude finished lots).
  checkBudget(home, tasks.length * 3);
  const work1 = async ({ annotator, lot, out }) => {
    const prompt = buildPrompt({ profilePrompt, pack, items: lot.items, mode, goldenPack, context: context.get(annotator) ?? new Map() });
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
        // Review N3: ONE counted intent per attempt — quota retries are free (intent:false
        // traced) and never burn the 22 000 cap; every counted re-call checks the budget first.
        // Review §5: intent counted BEFORE the paid call, so a kill after the call cannot
        // lose the spend (intents count, result records carry intent:false).
        checkBudget(home, 1);
        appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: true, phase: phase ?? `pass${pass}`, pass, mode, guide, annotator, lotId: lot.lotId, items: lot.items.length, attempt: attempts, promptSha256: promptSha });
        r = await callSeat(annotator, prompt, { base: seatTmp, timeoutMs: 3600000 });
        for (;;) {
          const wait = quotaWaitMs(r);
          if (wait === null) break;
          log(`[pass ${pass}] ${annotator} quota reached, waiting ${Math.round(wait / 60000)} min`);
          appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: phase ?? `pass${pass}`, pass, mode, guide, annotator, lotId: lot.lotId, items: lot.items.length, attempt: attempts,
            quota: true, quotaWaitMs: wait, exitCode: r.code });
          // Review D1: the quota-wait override is test-only (production refuses it).
          const quotaOverride = testQuotaWaitMs(process.env);
          const effectiveWait = quotaOverride !== undefined ? quotaOverride : wait;
          await sleep(effectiveWait);
          // Free retry after a quota denial: no new counted intent, no extra budget burn.
          r = await callSeat(annotator, prompt, { base: seatTmp, timeoutMs: 3600000 });
        }
        atomicWrite(rawFile, JSON.stringify(r), { mode: 0o600 });
      }
      pairs = parseAnswers(r.text, lot.items);
      const answered = pairs.filter((p) => p.answer).length;
      appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: phase ?? `pass${pass}`, pass, mode, guide, annotator, lotId: lot.lotId, items: lot.items.length, attempt: attempts,
        exitCode: r.code, latencyMs: r.latencyMs, reused, answered, toolEvents: r.toolEvents ?? null, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null });
      if (r.code === 0 && answered > 0 && !(r.toolEvents > 0)) break;
    }
    // Explicit exit policy, logged: a non-zero seat exit makes every vote of the lot
    // inadmissible (execution failure = missing vote, never a negative).
    const { exitAdmissible, pairs: kept } = applyExitPolicy(pairs, r);
    pairs = kept;
    if (!exitAdmissible) log(`[pass ${pass}] ${annotator} ${lot.lotId} seat exit code ${r.code}: votes inadmissible (fail-closed exit policy)`);
    if (r.toolEvents > 0) pairs = pairs.map((p) => ({ ...p, answer: null }));
    const extraction = toExtraction({ annotator, pass, guideVersion: pack.guideVersion, pairs, codes, goldenRows });
    const rel = path.join('runs', `pass${pass}`, annotator, `${lot.lotId}.json`);
    atomicWrite(path.join(work, rel), JSON.stringify(extraction), { mode: 0o600 });
    const validation = extraction.nodes.length ? validateExtraction(work, rel) : { valid: false, issues: [] };
    // Fail closed: if Engram itself could not run, every item is an execution failure until
    // `make classif-l2-revalidate` re-checks the saved extraction (no seat call).
    const engramDown = (validation.issues ?? []).some((i) => i.code === 'engram_failed');
    const validity = !exitAdmissible ? pairs.map(({ item }) => ({ itemId: item.itemId, valid: false, issues: ['non-zero-exit'] }))
      : engramDown ? pairs.map(({ item }) => ({ itemId: item.itemId, valid: false, issues: ['engram_failed'] })) : itemValidity(extraction, validation, pairs, codes, { goldenRows });
    const annotations = pairs.map(({ item, answer }, i) => ({
      itemId: item.itemId, kind: item.kind, valid: validity[i].valid, issues: validity[i].issues,
      code: answer ? String(answer.code ?? '') : null, verdict: answer ? codes.get(String(answer.code ?? '')) ?? null : null,
      ambiguous: answer ? answer.ambiguous === true : null, cause: answer?.ambiguity_cause ?? null, quote: answer?.quote ?? null,
      reason: answer?.reason ?? null, changed: answer?.changed ?? null,
      goldenPrecedent: Array.isArray(answer?.golden_precedent) ? answer.golden_precedent.filter((x) => Number.isInteger(x)) : [],
      labelProvenance: typeof answer?.label_provenance === 'string' ? answer.label_provenance : null,
      quoteFound: extraction.nodes.find((n) => n.id === `annotation:${annotator}:p${pass}:${item.itemId}`)?.quote_found ?? null,
    }));
    atomicWrite(out, JSON.stringify({ pass, mode, guide, annotator, lotId: lot.lotId, promptSha256: sha256(prompt), packSha256: pack.sha256, attempts,
      exitCode: r.code, exitAdmissible, latencyMs: r.latencyMs, usage: r.usage ?? null, engramValid: validation.valid ?? false, engramIssues: (validation.issues ?? []).length,
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
  const deferred = arg('--deferred', '') ? arg('--deferred', '').split(',').filter(Boolean) : [];
  const annotators = ANNOTATORS.filter((a) => !deferred.includes(a));
  const home = classifHome();
  const todoFile = path.join(home, 'l2', `pass${pass}`, 'todo.json');
  const ctxFile = path.join(home, 'l2', `pass${pass}`, 'context.json');
  // Review §4 + §3b: manual passes ≥ 2 require HALF∈{tuning,blind} and the COMMITTED split.
  // Blind runs only in crossreview mode (checked before the split, so an independent blind
  // review is refused even without a split), under the frozen FINAL guide (sha-checked,
  // fail closed) and before the blind seal. Sync guards (no top-level await cycle).
  if (pass >= 2) {
    const half = arg('--half', '');
    if (half !== 'tuning' && half !== 'blind') { process.stderr.write('classif-l2-pass: refusing pass ≥ 2 without --half tuning|blind (D2 firewall)\n'); process.exit(2); }
    if (half === 'blind' && mode !== 'crossreview') { process.stderr.write('classif-l2-pass: blind half requires --mode crossreview (independent blind review bypasses cross-review)\n'); process.exit(2); }
    if (half === 'blind' && guide !== 'FINAL') { process.stderr.write('classif-l2-pass: blind half requires --guide FINAL (frozen guide only)\n'); process.exit(2); }
    try {
      requireCommittedSplitSync();
    } catch (e) {
      process.stderr.write(`classif-l2-pass: ${e.message}\n`);
      process.exit(2);
    }
    if (half === 'blind') {
      try {
        assertFinalGuide(home);
      } catch (e) {
        process.stderr.write(`classif-l2-pass: ${e.message}\n`);
        process.exit(2);
      }
      if (existsSync(sealedFile(home))) { process.stderr.write('classif-l2-pass: blind half refused, the blind half is already sealed\n'); process.exit(2); }
    }
  }
  let todo = pass > 1 && existsSync(todoFile) ? new Set(JSON.parse(readFileSync(todoFile, 'utf8')).items) : null;
  // D2: a manual pass on one half is filtered by the committed split (the chain does it too).
  if (todo && arg('--half', '')) {
    const split = JSON.parse(readFileSync(path.join(classifDir(process.env), 'l3', 'manifests', 'split.json'), 'utf8'));
    const keep = new Set(split.halves[arg('--half', '')] ?? []);
    todo = new Set([...todo].filter((id) => keep.has(id)));
  }
  if (pass > 1 && !todo) { process.stderr.write(`classif-l2-pass: ${todoFile} missing (run make classif-l2-converge first)\n`); process.exit(2); }
  const context = existsSync(ctxFile) ? new Map(Object.entries(JSON.parse(readFileSync(ctxFile, 'utf8'))).map(([a, m]) => [a, new Map(Object.entries(m))])) : new Map();
  // Cross-review consults the golden pack (plan v3 A2): shared loader, fail closed when absent.
  const golden = mode === 'crossreview' ? loadGoldenPack(home) : { goldenPack: null, goldenRows: null };
  const goldenPack = golden.goldenPack;
  const goldenRows = golden.goldenRows;
  runPass({ pass, mode, guide, annotators, todo, context, goldenPack, goldenRows, concurrency: Number(arg('--concurrency', '4')), home, onlyLots: arg('--lots', '') ? arg('--lots', '').split(',') : null })
    .then((r) => process.stdout.write(`${JSON.stringify(r)}\n`))
    .catch((err) => { process.stderr.write(`classif-l2-pass: ${err.stack}\n`); process.exit(1); });
}
