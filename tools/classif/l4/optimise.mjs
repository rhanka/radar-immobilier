#!/usr/bin/env node
// make classif-l4-optimise SERIES=<k> ENV=preprod — prompt tuning (plan v3 C/D, review §A-2a).
//
// Inputs (tuning half ONLY): tuning-half reference rows, per-route tuning outputs and errors,
// tuning aggregates. NEVER the blind half, its inputs, its outputs, its aggregates, the sealed
// files, or the key: buildOptimiserPrompt() takes exactly the tuning materials and THROWS on
// any blind key (fail-closed firewall, covered by the unit test).
//
// Two max optimisers (default muse-wonder-max, opus-5.5-max) each propose P(k+1); one reconciliation
// round (default muse-wonder-max) fuses both proposals into a SINGLE common prompt. The frozen prompt
// is shingle-checked (no verbatim golden excerpt, review §C) before it lands in
// tools/classif/l4/prompts/P<k+1>.md; its sha is recorded in the repo manifest. The conductor
// commits the frozen prompt (freeze + commit before the blind run).
//
// Bounded REPAIR pass: when the shingle check refuses the fused prompt, the same reconciler
// seat gets at most MAX_REPAIRS rewrite calls. A repair prompt carries ONLY a fixed generic
// instruction plus the candidate prompt the model itself produced: never the offending
// shingle, a hit position, nor any sealed or golden text. Still refused after the last
// repair: fail closed, as before. Every call is cached by prompt sha, so a re-run replays
// the proposals, the reconciliation and any completed repair without a new paid call.
//
// Seat override (owner decision 06/11, recorded method deviation): `--optimisers a,b` and
// `--reconciler x` replace the defaults with other max seats of run-seat.mjs ROUTES. Any
// non-default selection is written to the manifest with a `deviation` text. A seat answer
// carrying tool events (astra codex stream) is refused and never cached (fail-closed tool
// policy, as for the L2 votes).
//
// Recall-first objective (owner rule 06/11, binding: « a lower recall is a regression »): the
// optimiser and reconciliation prompts state the HARD CONSTRAINT (zero tuning P/S item
// predicted non_pertinent, tuning recall >= the best tuning recall of any previous series),
// list EVERY tuning miss per route, and give the baseline prompt (best recall series) next to
// the current one. Precision is improved only under that constraint.
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROUTES, callSeat, parseJsonObject } from '../run-seat.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/render.mjs';
import { classifDir, classifHome, privateDir } from '../lib/paths.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';
import { check as budgetCheck } from '../lib/budget.mjs';
import { bestRecallBaseline, shownMisses } from './metrics.mjs';

export const OPTIMISERS = ['muse-wonder-max', 'opus-5.5-max'];
export const RECONCILER = 'muse-wonder-max';
export const MAX_REPAIRS = 2;
export const REPAIR_INSTRUCTION = 'The candidate prompt contains text copied verbatim from source documents; rewrite every example or quoted passage in your own general words, never quote document text, keep all rules.';
export const TUNING_KEYS = ['tuningRef', 'tuningOutputs', 'errors', 'aggregates', 'currentPrompt', 'baselinePrompt'];
/** Seats an override may name: the max-effort routes of run-seat.mjs. */
export const MAX_SEATS = Object.entries(ROUTES).filter(([, r]) => r.effort === 'max').map(([label]) => label);
export const OWNER_DEVIATION_0611 = {
  optimisers: ['astra-max', 'opus-5.5-max'],
  reconciler: 'opus-5.5-max',
  text: 'owner 06/11: Muse weekly quota exhausted until 08/11 — Astra max replaces Muse Wonder max as optimiser; Opus 5.5 max reconciles',
};

/**
 * Recall-first objective (owner rule 06/11, binding): « a lower recall is a regression ».
 * Stated verbatim in the optimiser and the reconciliation prompts.
 */
export const HARD_CONSTRAINT = 'HARD CONSTRAINT (recall first, non-negotiable): zero tuning-half item whose expected verdict is pertinent or a_surveiller may be predicted non_pertinent, and the tuning shown recall of every route must stay greater than or equal to the baseline (the best tuning recall of any previous series). The ONLY penalised error is a pertinent/a_surveiller item predicted non_pertinent; a pertinent <-> a_surveiller confusion is NOT penalised. Precision is improved ONLY under that constraint: reject any rule that could turn a single pertinent/a_surveiller item into non_pertinent, and when in doubt keep the item shown (a_surveiller) rather than discard it.';

/**
 * Objective section from the tuning materials: the hard constraint, the baseline recall and
 * EVERY tuning miss per route (reference P/S → predicted non_pertinent) with its expected
 * code. Tuning material only (the firewall of buildOptimiserPrompt guards the inputs).
 */
export function buildObjective({ tuningOutputs = {}, baselinePrompt = null } = {}) {
  const base = baselinePrompt
    ? `Baseline: series ${baselinePrompt.series} (prompt ${baselinePrompt.version}), best tuning shown recall of any previous series = ${Number(baselinePrompt.best).toFixed(3)}; per-route baseline recall: ${Object.entries(baselinePrompt.recall ?? {}).map(([r, v]) => `${r} ${Number(v).toFixed(3)}`).join(', ') || 'none'}.`
    : 'Baseline: no earlier series recall on record; the constraint is zero tuning miss.';
  const misses = Object.entries(tuningOutputs).map(([route, rows]) => {
    const list = shownMisses(rows);
    return `## ${route}: ${list.length} miss(es)\n${list.length ? list.map((o) => `- ${o.itemId}: expected ${o.ref} (${o.refVerdict}) → predicted ${o.pred?.code ?? '?'} (non_pertinent)`).join('\n') : '- none'}`;
  }).join('\n\n');
  return `OBJECTIVE, in strict priority order.
${HARD_CONSTRAINT}
${base}

Tuning misses per route (expected pertinent/a_surveiller → predicted non_pertinent), EVERY one listed; each must become shown (pertinent or a_surveiller) without creating a new one:
${misses || '- no route output'}`;
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Optimiser and reconciler seats from the CLI flags. Defaults unchanged; an override names
 * exactly 2 distinct max seats (+ 1 max reconciler). A non-default selection carries a
 * deviation text: --deviation, or the recorded owner 06/11 text when it matches that decision.
 */
export function resolveSeats({ optimisers = null, reconciler = null, deviation = null } = {}) {
  const opt = optimisers ? String(optimisers).split(',').map((s) => s.trim()).filter(Boolean) : [...OPTIMISERS];
  const rec = reconciler ? String(reconciler).trim() : RECONCILER;
  for (const s of [...opt, rec]) {
    if (!MAX_SEATS.includes(s)) throw new Error(`classif-l4-optimise: unknown seat ${s} (known max seats: ${MAX_SEATS.join(',')})`);
  }
  if (opt.length !== 2) throw new Error(`classif-l4-optimise: OPTIMISERS needs exactly 2 seats, got ${opt.length}`);
  if (opt[0] === opt[1]) throw new Error(`classif-l4-optimise: duplicated optimiser pair ${opt.join(',')}`);
  const isDefault = sameList(opt, OPTIMISERS) && rec === RECONCILER;
  if (isDefault) return { optimisers: opt, reconciler: rec, deviation: null };
  const owner = sameList(opt, OWNER_DEVIATION_0611.optimisers) && rec === OWNER_DEVIATION_0611.reconciler;
  const text = deviation ? String(deviation).trim() : (owner ? OWNER_DEVIATION_0611.text : '');
  if (!text) throw new Error('classif-l4-optimise: a non-default seat selection needs DEVIATION="<recorded reason>"');
  return { optimisers: opt, reconciler: rec, deviation: text };
}

/**
 * Optimiser prompt from the tuning materials ONLY. Any blind-half key throws: nothing from
 * the blind half ever enters an optimiser input (plan v3 D3).
 */
export function buildOptimiserPrompt(materials) {
  const blindKeys = Object.keys(materials).filter((k) => !TUNING_KEYS.includes(k) || /blind/i.test(k));
  if (blindKeys.length) throw new Error(`optimiser firewall: refusing blind material (${blindKeys.join(',')})`);
  const { tuningRef, tuningOutputs, errors, aggregates, currentPrompt, baselinePrompt = null } = materials;
  const baselineSection = !baselinePrompt ? ''
    : baselinePrompt.text
      ? `\nBaseline prompt ${baselinePrompt.version} (series ${baselinePrompt.series}, the best tuning recall so far). You MAY restart from it instead of the current prompt when the current prompt lost recall:
---
${baselinePrompt.text.trim()}
---
`
      : `\nThe current prompt is itself the baseline (series ${baselinePrompt.series}, the best tuning recall so far).\n`;
  return `You improve a municipal regulatory classification prompt for a residential densification radar (Québec).
You see ONLY the tuning half: ${tuningRef.length} tuning reference rows (expected code and verdict per item, unresolved rows excluded from scoring), the tuning outputs and errors of the evaluated routes, and the tuning aggregates (Annex M metrics). The blind half exists but you will NEVER see it: do not ask for it, do not guess its content.

${buildObjective({ tuningOutputs, baselinePrompt })}

Current prompt P (frozen):
---
${currentPrompt.trim()}
---
${baselineSection}
Tuning reference (item_id, expected code/verdict):
${tuningRef.map((r) => `- ${r.itemId}: ${r.code} (${r.verdict})`).join('\n')}

Tuning aggregates per route (Annex M shown recall/precision, failures, cost):
${JSON.stringify(aggregates, null, 1)}

Tuning outputs per route (item_id, expected code/verdict → predicted code/verdict, first 40 per route):
${Object.entries(tuningOutputs).map(([route, list]) => `## ${route}\n${list.slice(0, 40).map((o) => `- ${o.itemId}: ${o.ref} (${o.refVerdict}) → ${o.pred?.code ?? 'FAILED'} (${o.pred?.verdict ?? o.why ?? 'failed'})`).join('\n')}`).join('\n\n')}

Tuning errors per route (item_id, expected → predicted, failures and code errors included, first 60 per route):
${Object.entries(errors).map(([route, list]) => `## ${route}\n${list.slice(0, 60).map((e) => `- ${e.itemId}: ${e.ref} (${e.refVerdict}) → ${e.predCode ?? e.pred ?? 'FAILED'} (${e.pred ?? e.why ?? ''})${e.failed ? ' [failure]' : ''}`).join('\n')}`).join('\n\n')}

Propose the FULL next prompt P(k+1): same task, same answer schema (one JSON object per item: verdict, code, ambiguous, citation; verdict = registry partition of the code), improved ONLY from the tuning evidence above and under the HARD CONSTRAINT first, precision second. General rules, never item-specific tricks, never a copied tuning example. Return ONLY the prompt text, no prose, no fences.`;
}

// `labels` names the candidate authors. `objective` is the recall-first objective section
// (buildObjective from the tuning materials); the default states the hard constraint alone.
export function buildReconciliationPrompt(proposals, labels = OPTIMISERS, objective = buildObjective()) {
  return `You fuse two candidate classification prompts into ONE single common prompt. Both candidates address the same task (municipal regulatory items, verdict+code JSON per item, verdict = registry partition of the code). Keep every improvement both agree on; when they disagree, the rule that keeps more pertinent/a_surveiller items shown wins over the rule that gains precision; otherwise keep the rule best supported by the tuning evidence, never both variants. Output the single fused prompt ONLY: full text, no prose, no fences, no tuning example copied verbatim.

${objective}

## Candidate A (${labels[0]})
---
${proposals[0].trim()}
---

## Candidate B (${labels[1]})
---
${proposals[1].trim()}
---`;
}

/**
 * Repair prompt: the fixed generic instruction plus the candidate ONLY. Its single input is
 * the candidate the model produced, so no shingle, hit detail, sealed or golden text can
 * reach the model through it.
 */
export function buildRepairPrompt(candidate) {
  return `${REPAIR_INSTRUCTION} Same task, same answer schema (one JSON object per item: verdict, code, ambiguous, citation; verdict = registry partition of the code). Output the full rewritten prompt ONLY: no prose, no fences.

## Candidate prompt
---
${candidate.trim()}
---`;
}

/** true when the text passes the shingle check; a verbatim refusal returns false, any other error (missing guard) rethrows. */
function passesShingleCheck(text, home, what) {
  try {
    assertNoVerbatim(text, home, { what });
    return true;
  } catch (e) {
    if (/^freeze refused:/.test(e.message)) return false;
    throw e;
  }
}

/**
 * Shingle-checks the fused prompt; on refusal runs up to `maxRepairs` repair calls on the
 * reconciler seat (phase <phaseBase>-repair<n>, default l4-opt-s<k>, budget-checked before each
 * call). Each repair rewrites the latest candidate. Returns { text, repairs }; throws (fail
 * closed) when the candidate is still refused after the last repair. GEPA reuses it with its
 * own phaseBase and candidate label (`what`).
 */
export async function shingleCheckWithRepair({ home, callsLog, k, fusedText, call = seatCall, maxRepairs = MAX_REPAIRS, reconciler = RECONCILER,
  phaseBase = `l4-opt-s${k}`, what = `prompt P${Number(k) + 1}` }) {
  let text = fusedText;
  let repairs = 0;
  while (!passesShingleCheck(text, home, what)) {
    if (repairs >= maxRepairs) assertNoVerbatim(text, home, { what: `${what} after ${repairs} repair(s)` });
    repairs++;
    process.stderr.write(`classif-l4-optimise: shingle check refused ${what}; repair ${repairs}/${maxRepairs}\n`);
    budgetCheck(home, 1);
    const repaired = parseProposal(await call(home, callsLog, `${phaseBase}-repair${repairs}`, reconciler, buildRepairPrompt(text)));
    if (!repaired) throw new Error(`repair ${repairs} returned no usable prompt`);
    text = repaired;
  }
  return { text, repairs };
}

/** Extracts the proposed prompt text from an optimiser answer (raw text wins, JSON wrapped ok). */
export function parseProposal(text) {
  const t = String(text ?? '').replace(/```(?:markdown|md|text)?/g, '').trim();
  if (t.length < 200) return null;
  const j = parseJsonObject(t);
  if (j && typeof j.prompt === 'string' && j.prompt.trim().length >= 200) return j.prompt.trim();
  if (t.startsWith('{')) return null;
  return t;
}

/**
 * Recall baseline of the optimiser (owner rule 06/11): over the tuning dev manifests of series
 * 0..k (metrics only), the series with the best tuning recall among non-failed routes (earliest
 * on a tie) and its frozen prompt. `text` is null when the baseline is the current series.
 * Returns null when no dev manifest carries an eligible route.
 */
export function loadBaselinePrompt(repoClassif, k) {
  const manifests = [];
  for (let j = 0; j <= Number(k); j++) {
    const f = path.join(repoClassif, 'l4', 'manifests', `series-${j}-dev.json`);
    if (existsSync(f)) manifests.push({ series: j, aggregates: JSON.parse(readFileSync(f, 'utf8')).aggregates });
  }
  const b = bestRecallBaseline(manifests);
  if (!b) return null;
  const version = `P${b.series}`;
  const text = b.series === Number(k) ? null : readFileSync(path.join(repoClassif, 'l4', 'prompts', `${version}.md`), 'utf8');
  return { series: b.series, version, best: b.best, recall: b.perRoute, text };
}

// Review §8: optimiser calls cached like amend cachedCall — a crash never repays a
// returned proposal (keyed by prompt sha256). `seat` is the paid seat (callSeat; a fake in tests).
// `rawDir` moves the cache (GEPA keeps it inside its run directory).
export async function seatCall(home, callsLog, phase, annotator, prompt, seat = callSeat, { rawDir = path.join(home, 'l4', 'opt-raw') } = {}) {
  const key = sha256(prompt).slice(0, 16);
  const file = path.join(rawDir, `${phase}.${annotator}.${key}.json`);
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    if (c.promptSha256 === sha256(prompt) && typeof c.text === 'string') return c.text;
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: true, phase, annotator });
  const r = await seat(annotator, prompt, { base: privateDir(path.join(home, 'l4', 'seat-tmp')), timeoutMs: 3600000 });
  appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase, annotator, exitCode: r.code,
    latencyMs: r.latencyMs, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null, toolEvents: r.toolEvents ?? null });
  if (r.code !== 0) throw new Error(`optimiser ${annotator} failed with seat exit ${r.code}`);
  // Fail-closed tool policy (L2 parity): an answer produced with tool events is inadmissible and never cached.
  if ((r.toolEvents ?? 0) > 0) throw new Error(`optimiser ${annotator} answer refused: ${r.toolEvents} tool event(s) (fail-closed tool policy)`);
  writeFileSync(file, JSON.stringify({ promptSha256: sha256(prompt), text: r.text }), { mode: 0o600 });
  return r.text;
}

export async function main(argv = process.argv.slice(2), { seat = callSeat } = {}) {
  const call = (h, log, phase, annotator, p) => seatCall(h, log, phase, annotator, p, seat);
  const repoClassif = classifDir(process.env);
  const k = argv.includes('--series') ? argv[argv.indexOf('--series') + 1] : process.env.SERIES;
  if (!k) { process.stderr.write('classif-l4-optimise: pass SERIES=<k>\n'); process.exit(2); }
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? '' : null);
  const deferred = argv.includes('--deferred') ? argv[argv.indexOf('--deferred') + 1].split(',').filter(Boolean) : [];
  // Seat override validated before any file read, budget check or paid call.
  const seats = resolveSeats({ optimisers: flag('--optimisers'), reconciler: flag('--reconciler'), deviation: flag('--deviation') });
  const { reconciler, deviation } = seats;
  const optimisers = seats.optimisers.filter((o) => !deferred.includes(o));
  if (optimisers.length < 2) { process.stderr.write('classif-l4-optimise: refusing with fewer than 2 optimisers (single-author prompts break the reconciliation rule)\n'); process.exit(2); }
  const home = classifHome();
  const dir = path.join(home, 'l4', `series-${k}`);
  const currentPrompt = readFileSync(path.join(repoClassif, 'l4', 'prompts', `P${k}.md`), 'utf8');
  const ref = parseJsonlTolerant(readFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), 'utf8'));
  const tuningRef = ref.filter((r) => r.half === 'tuning' && r.status === 'resolved').map((r) => ({ itemId: r.itemId, code: r.code, verdict: r.verdict }));
  const devManifest = JSON.parse(readFileSync(path.join(repoClassif, 'l4', 'manifests', `series-${k}-dev.json`), 'utf8'));
  const tuningOutputs = {};
  for (const route of devManifest.routes) {
    tuningOutputs[route] = parseJsonlTolerant(readFileSync(path.join(dir, `dev-${route}.jsonl`), 'utf8'));
  }
  const errors = JSON.parse(readFileSync(path.join(dir, 'errors.json'), 'utf8'));
  // Review N7: refuse the overwrite BEFORE any paid call or budget check — a frozen
  // P(k+1) must fail before burning optimiser calls (the cache softened the old order).
  const next = Number(k) + 1;
  const outPrompt = path.join(repoClassif, 'l4', 'prompts', `P${next}.md`);
  if (existsSync(outPrompt)) throw new Error(`classif-l4-optimise: refusing to overwrite frozen prompt ${outPrompt}`);
  // D5: 2 proposals + 1 reconciliation + at most MAX_REPAIRS repairs (planned up front, and
  // re-checked before each repair call).
  budgetCheck(home, optimisers.length + 1 + MAX_REPAIRS);
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  const baselinePrompt = loadBaselinePrompt(repoClassif, k);
  const materials = { tuningRef, tuningOutputs, errors, aggregates: devManifest.aggregates, currentPrompt, ...(baselinePrompt ? { baselinePrompt } : {}) };
  const prompt = buildOptimiserPrompt(materials);
  const proposals = [];
  for (const o of optimisers) {
    const text = await call(home, callsLog, `l4-opt-s${k}`, o, prompt);
    const parsed = parseProposal(text);
    if (!parsed) throw new Error(`optimiser ${o} returned no usable prompt (too short or JSON-only)`);
    proposals.push(parsed);
  }
  const fused = await call(home, callsLog, `l4-opt-s${k}-reconcile`, reconciler, buildReconciliationPrompt(proposals, optimisers, buildObjective(materials)));
  const fusedText = parseProposal(fused);
  if (!fusedText) throw new Error('reconciliation returned no usable prompt');
  // Review §C: no verbatim golden excerpt in any prompt — shingle check (bounded repair) before the freeze.
  const { text: frozenText, repairs } = await shingleCheckWithRepair({ home, callsLog, k, fusedText, call, reconciler });
  writeFileSync(outPrompt, `${frozenText.trim()}\n`);
  const manifest = { kind: 'l4-optimise', series: k, next: `P${next}`, createdAt: new Date().toISOString(),
    optimisers, reconciler, ...(deviation ? { deviation } : {}),
    proposalSha256: proposals.map((p) => sha256(p)), promptSha256: sha256(`${frozenText.trim()}\n`),
    tuningItems: tuningRef.length, repairs,
    objective: { rule: 'recall first: zero tuning P/S item predicted non_pertinent, tuning recall >= baseline; precision only under that constraint',
      baselineSeries: baselinePrompt?.series ?? null, baselineVersion: baselinePrompt?.version ?? null, baselineRecall: baselinePrompt?.best ?? null,
      tuningMisses: Object.fromEntries(Object.entries(tuningOutputs).map(([route, rows]) => [route, shownMisses(rows).length])) },
    shingleCheck: 'pass (0 verbatim shingles from the sealed set)' };
  mkdirSync(path.join(repoClassif, 'l4', 'manifests'), { recursive: true });
  writeFileSync(path.join(repoClassif, 'l4', 'manifests', `series-${k}-optimise.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'optimise.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-optimise: ${err.stack}\n`); process.exit(1); });
}
