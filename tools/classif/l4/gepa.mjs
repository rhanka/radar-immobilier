#!/usr/bin/env node
// make classif-l4-gepa SERIES=<k> MAX_CALLS=5000 ENV=preprod — GEPA prompt optimisation
// (owner-validated method: population of prompts, reflective mutation, per-case Pareto selection).
//
// Objective (lexicographic, l4/gepa-common.mjs): 1. zero miss — a reference pertinent or
// a_surveiller predicted non_pertinent on ANY of the 5 evaluation routes counts (a failed call
// counts as shown); 2. then minimise noise — a reference non_pertinent predicted shown. A
// pertinent <-> a_surveiller confusion is not penalised. A case score sums the 5 routes.
//
// Data: the TUNING half only (half === 'tuning', status resolved), split by a recorded seed
// into D_feedback (~60 %, mutations) and D_pareto (~40 %, selection), stratified by verdict.
// The blind half is never read: this module opens no blind file and imports no blind helper;
// the split refuses any non-tuning row and the prompt builders refuse any non-allowed key or
// non-tuning trace (same firewall as optimise.mjs buildOptimiserPrompt).
//
// Loop: population = P0..P4. Each iteration draws a parent from the per-case Pareto front on
// D_pareto (weighted by the cases it wins, ties included), builds a mini-batch of ~30
// D_feedback cases (the parent's known misses first, then its known noise cases, then a seeded
// random fill), and asks astra-max for a reflective rewrite from the error traces (misses
// first, then noise: excerpt, expected, prediction and justification per route). About one
// iteration in three is a crossover of two front parents instead. Fallback and repair seat:
// opus-5.5-max; every candidate passes assertNoVerbatim with the bounded repair of
// optimise.mjs (2 rewrites at most). Admission: the child is evaluated on the mini-batch over
// the 5 routes; rejected with more misses than the parent, or with equal misses and no less
// noise; otherwise evaluated on D_pareto and added to the population.
//
// Final choice: the best front candidates with 0 miss on D_pareto are evaluated on the whole
// tuning half (D_feedback too, 5 routes); only those with 0 miss in total are retained, the one
// with the least noise wins. None retained → result `no-candidate`, no fallback. The winner is
// frozen as l4/prompts/P<k>.md (shingle-checked), the metrics-only manifest
// l4/manifests/series-<k>-gepa.json records the run, and the winner's evaluated rows seed the
// dev per-item cache of series k (same prompt bytes, same route, same item).
//
// Budget: MAX_CALLS (default 5000) is a run cap enforced by lib/budget.mjs runBudget (phases
// `l4-gepa-<run>.*`), on top of the pilot cap. An iteration starts only when its planned calls
// plus the reserve of one final evaluation fit; the loop then stops cleanly and the final
// choice uses what remains. Resume is idempotent: per-call caches, candidate files and the
// iteration journal in $CLASSIF_HOME/l4/gepa-<run>/ (iterations.jsonl) replay every finished
// step without a paid call.
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { callSeat, parseJsonObject } from '../run-seat.mjs';
import { appendJsonlRecord, parseJsonlTolerant, readJsonlRecords } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/render.mjs';
import { classifDir, classifHome, privateDir } from '../lib/paths.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';
import { runBudget } from '../lib/budget.mjs';
import { loadCodes } from '../l2/run.mjs';
import { devPrompt, parseDevAnswer } from './dev.mjs';
import { groupRoutesByFamily, runFamiliesParallel } from './families.mjs';
import { shownMisses } from './metrics.mjs';
import { MAX_REPAIRS, parseProposal, seatCall, shingleCheckWithRepair } from './optimise.mjs';
import { GEPA_FAILURE_CEILING, GEPA_METHOD, GEPA_MUTATOR, GEPA_RECONCILER, GEPA_ROUTES, caseScore, compareScore, totalScore } from './gepa-common.mjs';

export const SEED_PROMPTS = ['P0', 'P1', 'P2', 'P3', 'P4'];
export const VERDICTS = ['pertinent', 'a_surveiller', 'non_pertinent'];
export const FEEDBACK_SHARE = 0.6;
export const MINIBATCH_SIZE = 30;
export const CROSSOVER_EVERY = 3;
export const FINAL_TOP = 3;
export const DEFAULT_MAX_CALLS = 5000;
export const EXCERPT_CHARS = 1500;
export const JUSTIFICATION_CHARS = 300;
/** Firewall allow-lists of the two prompt builders (anything else, or any /blind/ key, throws). */
export const REFLECTION_KEYS = ['parentPrompt', 'traces'];
export const CROSSOVER_KEYS = ['promptA', 'promptB', 'labels'];
const MUTATION_CALLS_MAX = 2 + MAX_REPAIRS; // mutator + fallback + repairs

export const OBJECTIVE = `OBJECTIVE, in strict priority order:
1. ZERO MISS (hard constraint): an item whose expected verdict is pertinent or a_surveiller must NEVER be predicted non_pertinent, by any of the evaluated models. A miss on a single model counts.
2. Then minimise NOISE: an item whose expected verdict is non_pertinent predicted pertinent or a_surveiller.
A pertinent <-> a_surveiller confusion is NOT penalised. When in doubt, keep the item shown (a_surveiller) rather than discard it.`;

export const ANSWER_SCHEMA = 'Same task, same answer schema (one JSON object per item: verdict, code, ambiguous, citation; verdict = registry partition of the code).';

// ---------------------------------------------------------------- deterministic helpers

/** Seeded PRNG (mulberry32 on a sha256 of the seed and the parts). */
export function rngFor(seed, ...parts) {
  let a = parseInt(sha256([String(seed), ...parts.map(String)].join('\n')).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(ids, rng) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

const trunc = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ---------------------------------------------------------------- tuning data + split

/** Blind firewall: every row must be a resolved tuning row with a known verdict, ids unique. */
export function assertTuningRows(rows) {
  const seen = new Set();
  for (const r of rows) {
    if (r?.half !== 'tuning') throw new Error(`gepa firewall: refusing a non-tuning row (${r?.itemId ?? '?'}, half ${r?.half ?? 'unset'})`);
    if (r.status !== 'resolved') throw new Error(`gepa split refused: ${r.itemId} is not resolved`);
    if (!VERDICTS.includes(r.verdict)) throw new Error(`gepa split refused: ${r.itemId} has verdict ${r.verdict}`);
    if (seen.has(r.itemId)) throw new Error(`gepa split refused: duplicated item ${r.itemId}`);
    seen.add(r.itemId);
  }
}

/**
 * Deterministic stratified split of the tuning rows: per verdict stratum, items ordered by
 * sha256(seed, itemId), the first round(n × share) go to D_feedback, the rest to D_pareto.
 * Same seed + same rows → same split. The seed is recorded with the split.
 */
export function stratifiedSplit(rows, { seed, feedbackShare = FEEDBACK_SHARE } = {}) {
  if (seed === undefined || seed === null || String(seed) === '') throw new Error('gepa split refused: a recorded seed is required');
  assertTuningRows(rows);
  const feedback = [];
  const pareto = [];
  const strata = {};
  for (const v of VERDICTS) {
    const keyed = rows.filter((r) => r.verdict === v).map((r) => [sha256(`${seed}\n${r.itemId}`), r.itemId]);
    keyed.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1));
    const ids = keyed.map(([, id]) => id);
    const nf = Math.round(ids.length * feedbackShare);
    feedback.push(...ids.slice(0, nf));
    pareto.push(...ids.slice(nf));
    strata[v] = { total: ids.length, feedback: nf, pareto: ids.length - nf };
  }
  feedback.sort();
  pareto.sort();
  return { seed: String(seed), feedbackShare, feedback, pareto, strata,
    sha256: { feedback: sha256(`${feedback.join('\n')}\n`), pareto: sha256(`${pareto.join('\n')}\n`) } };
}

/**
 * Tuning rows with their frozen input. Same filter as optimise.mjs (half tuning, resolved);
 * no blind file is opened, and only tuning inputs leave this function.
 */
export function readGepaTuning(home) {
  const ref = parseJsonlTolerant(readFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), 'utf8'));
  const tuning = ref.filter((r) => r.half === 'tuning' && r.status === 'resolved');
  const ids = new Set(tuning.map((r) => r.itemId));
  const corpus = new Map();
  for (const i of parseJsonlTolerant(readFileSync(path.join(home, 'l0', 'dev-items.jsonl'), 'utf8'))) if (ids.has(i.itemId)) corpus.set(i.itemId, i.input);
  const rows = tuning.map((r) => ({ itemId: r.itemId, code: r.code, verdict: r.verdict, half: r.half, status: r.status, input: corpus.get(r.itemId) ?? null }));
  if (rows.some((r) => !r.input)) throw new Error('classif-l4-gepa: tuning row without frozen input');
  assertTuningRows(rows);
  return rows;
}

// ---------------------------------------------------------------- Pareto front + admission

/**
 * Per-case Pareto front on `ids`: a candidate stays when it is the best (ties included) on at
 * least one case; `wins` = number of such cases. Candidates: [{ id, scores: { itemId: score } }].
 */
export function paretoFront(candidates, ids) {
  const wins = new Map(candidates.map((c) => [c.id, 0]));
  for (const id of ids) {
    let best = null;
    for (const c of candidates) {
      const s = c.scores[id];
      if (!s) throw new Error(`gepa: candidate ${c.id} has no score for case ${id}`);
      if (!best || compareScore(s, best) < 0) best = s;
    }
    for (const c of candidates) if (compareScore(c.scores[id], best) === 0) wins.set(c.id, wins.get(c.id) + 1);
  }
  return candidates.filter((c) => wins.get(c.id) > 0).map((c) => ({ id: c.id, wins: wins.get(c.id) }));
}

/** Weighted draw from the front (weight = cases won); `exclude` removes ids first. */
export function sampleFromFront(front, rng, { exclude = [] } = {}) {
  const pool_ = front.filter((f) => !exclude.includes(f.id));
  if (!pool_.length) throw new Error('gepa: empty front');
  const total = pool_.reduce((s, f) => s + f.wins, 0);
  let x = rng() * total;
  for (const f of pool_) {
    x -= f.wins;
    if (x < 0) return f.id;
  }
  return pool_[pool_.length - 1].id;
}

/**
 * Mini-batch of D_feedback: the parent's known misses first, then its known noise cases (each
 * tier in seeded random order), then a seeded random fill; `size` cases at most.
 */
export function selectMinibatch(feedbackIds, { misses = [], noise = [] } = {}, rng, size = MINIBATCH_SIZE) {
  const fb = new Set(feedbackIds);
  const tier1 = shuffled([...new Set(misses)].filter((id) => fb.has(id)).sort(), rng);
  const t1 = new Set(tier1);
  const tier2 = shuffled([...new Set(noise)].filter((id) => fb.has(id) && !t1.has(id)).sort(), rng);
  const taken = new Set([...tier1, ...tier2]);
  const rest = shuffled(feedbackIds.filter((id) => !taken.has(id)), rng);
  return [...tier1, ...tier2, ...rest].slice(0, Math.min(size, feedbackIds.length));
}

/**
 * Admission on the mini-batch: rejected with more misses than the parent, or with equal misses
 * and no less noise; admitted otherwise.
 */
export function admissionDecision(child, parent) {
  if (child.misses > parent.misses) return { admitted: false, reason: 'more-misses' };
  if (child.misses === parent.misses && child.noise >= parent.noise) return { admitted: false, reason: 'no-noise-gain' };
  return { admitted: true, reason: child.misses < parent.misses ? 'fewer-misses' : 'less-noise' };
}

/**
 * Final choice over evaluated finalists ({ id, total: { misses, noise, failures } }): only 0
 * miss in total is retained, the least noise wins (then fewer failures, then rank order).
 * Returns null when no finalist has 0 miss — no fallback.
 */
export function finalChoice(finalists) {
  const retained = finalists.filter((f) => f.status === 'evaluated' && f.total.misses === 0);
  if (!retained.length) return null;
  return [...retained].sort((a, b) => a.total.noise - b.total.noise || a.total.failures - b.total.failures || a.rank - b.rank)[0];
}

// ---------------------------------------------------------------- prompt builders (firewalled)

function assertKeys(materials, allowed, what) {
  const bad = Object.keys(materials ?? {}).filter((k) => !allowed.includes(k) || /blind/i.test(k));
  if (bad.length) throw new Error(`gepa firewall: refusing ${what} material (${bad.join(',')})`);
}

/**
 * Error traces of a candidate on a mini-batch: cases with a miss first (most routes first),
 * then cases with noise; per case the excerpt, the expected code/verdict and the prediction and
 * justification of every route. Only tuning rows are traced.
 */
export function buildTraces(evals, refById, { routes = GEPA_ROUTES } = {}) {
  const out = [];
  for (const [itemId, byRoute] of Object.entries(evals)) {
    const ref = refById.get(itemId);
    if (!ref) throw new Error(`gepa: no tuning reference for ${itemId}`);
    const s = caseScore(ref.verdict, Object.fromEntries(routes.map((r) => [r, byRoute[r]?.failed ? { failed: true } : byRoute[r]?.pred])), routes);
    if (!s.misses && !s.noise) continue;
    out.push({ itemId, half: ref.half, kind: s.misses ? 'miss' : 'noise', count: s.misses || s.noise,
      expected: { code: ref.code, verdict: ref.verdict }, excerpt: trunc(ref.input, EXCERPT_CHARS),
      predictions: routes.map((route) => {
        const row = byRoute[route];
        return { route, failed: !!row?.failed, code: row?.pred?.code ?? null, verdict: row?.pred?.verdict ?? null, justification: row?.justification ?? '' };
      }) });
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.count - a.count || (a.itemId < b.itemId ? -1 : 1) : a.kind === 'miss' ? -1 : 1));
}

/** Reflective mutation prompt: the parent prompt + its mini-batch error traces ONLY. */
export function buildReflectionPrompt(materials) {
  assertKeys(materials, REFLECTION_KEYS, 'reflection');
  const { parentPrompt, traces } = materials;
  for (const t of traces) if (t.half !== 'tuning') throw new Error(`gepa firewall: refusing a non-tuning trace (${t.itemId})`);
  const cases = traces.map((t, i) => `### Case ${i + 1} — ${t.kind === 'miss' ? 'MISS' : 'NOISE'} on ${t.count}/${t.predictions.length} model(s)
Expected: ${t.expected.code} (${t.expected.verdict})
Excerpt:
> ${t.excerpt}
Predictions:
${t.predictions.map((p) => `- ${p.route}: ${p.failed ? 'FAILED (counted as shown)' : `${p.code} (${p.verdict})`}${p.justification ? ` — ${p.justification}` : ''}`).join('\n')}`).join('\n\n');
  return `You improve a municipal regulatory classification prompt for a residential densification radar (Québec), by reflection on its errors.
You see ONLY a mini-batch of tuning-half cases classified with the current prompt by several models. The blind half exists but you will NEVER see it: do not ask for it, do not guess its content.

${OBJECTIVE}

Current prompt:
---
${parentPrompt.trim()}
---

Errors of the current prompt on the mini-batch (misses first, then noise): ${traces.length} case(s).

${cases || '- none'}

Diagnose why each miss and each noise case happened, then rewrite the FULL prompt so that every miss becomes shown without creating a new one, and noise drops only under that constraint. ${ANSWER_SCHEMA} General rules, never item-specific tricks, never copy an excerpt or any document text verbatim. Return ONLY the prompt text, no prose, no fences.`;
}

/** Crossover prompt: merges the rules of two front parents into one prompt. */
export function buildCrossoverPrompt(materials) {
  assertKeys(materials, CROSSOVER_KEYS, 'crossover');
  const { promptA, promptB, labels = ['A', 'B'] } = materials;
  return `You merge two classification prompts into ONE prompt. Both address the same task (municipal regulatory items for a residential densification radar, Québec). Each one is the best on some tuning cases: keep every rule of either prompt that keeps pertinent/a_surveiller items shown; when two rules conflict, the rule that keeps more items shown wins over the rule that gains precision; never keep both variants of a rule.

${OBJECTIVE}

${ANSWER_SCHEMA} Never copy document text verbatim. Return ONLY the merged prompt text, no prose, no fences.

## Prompt A (${labels[0]})
---
${promptA.trim()}
---

## Prompt B (${labels[1]})
---
${promptB.trim()}
---`;
}

// ---------------------------------------------------------------- evaluation (5 routes)

const evalCacheFile = (ctx, sha, route, itemId) => path.join(ctx.runDir, 'eval-cache', sha.slice(0, 16), route, `${itemId}.json`);

function readEvalCache(ctx, sha, route, itemId) {
  const f = evalCacheFile(ctx, sha, route, itemId);
  if (!existsSync(f)) return null;
  try {
    const c = JSON.parse(readFileSync(f, 'utf8'));
    if (c.promptSha256 === sha && c.route === route && c.itemId === itemId) return c.row;
  } catch { /* corrupt cache: re-run */ }
  return null;
}

/** Uncached (route, item) calls of a candidate over `ids`. */
export function uncachedCalls(ctx, sha, ids) {
  let n = 0;
  for (const route of ctx.routes) for (const id of ids) if (!readEvalCache(ctx, sha, route, id)) n++;
  return n;
}

/**
 * Evaluates a candidate on `ids` over every route (families in parallel, `concurrency` calls per
 * route). Returns { itemId: { route: row } }. Successful rows are cached per (prompt sha, route,
 * item); failures are not (retried on resume). Circuit breaker: a route failing more than
 * max(1, 5 %) of the batch stops the run (seat infrastructure, resume retries).
 */
export async function evaluateCandidate(ctx, cand, ids, step) {
  ctx.budget.check(uncachedCalls(ctx, cand.sha, ids));
  const phase = `${ctx.phase}.eval`;
  const runRoute = async (route) => {
    const rows = await pool(ids.map((id) => async () => {
      const hit = readEvalCache(ctx, cand.sha, route, id);
      if (hit) return hit;
      const item = ctx.refById.get(id);
      appendJsonlRecord(ctx.callsLog, { at: new Date().toISOString(), intent: true, phase, route, itemId: id, candidate: cand.id, step });
      const r = await ctx.seat(route, devPrompt(cand.text, item), { base: ctx.seatTmp, timeoutMs: 1800000 });
      appendJsonlRecord(ctx.callsLog, { at: new Date().toISOString(), intent: false, phase, route, itemId: id, candidate: cand.id, step,
        exitCode: r.code, latencyMs: r.latencyMs ?? null, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null, toolEvents: r.toolEvents ?? null });
      let parsed;
      if (r.code !== 0) parsed = { failed: true, why: `exit-${r.code}` };
      else if ((r.toolEvents ?? 0) > 0) parsed = { failed: true, why: 'tool-events' };
      else parsed = parseDevAnswer(r.text, ctx.codes);
      const j = parsed.failed ? null : parseJsonObject(r.text);
      const row = { itemId: id, pred: parsed.failed ? null : { verdict: parsed.verdict, code: parsed.code }, failed: parsed.failed, why: parsed.why ?? null,
        justification: trunc(j?.justification ?? j?.citation ?? j?.reason ?? '', JUSTIFICATION_CHARS),
        usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null };
      if (!row.failed) {
        const f = evalCacheFile(ctx, cand.sha, route, id);
        mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
        writeFileSync(f, JSON.stringify({ promptSha256: cand.sha, route, itemId: id, row }), { mode: 0o600 });
      }
      return row;
    }), ctx.concurrency);
    const failures = rows.filter((r) => r.failed).length;
    const allowed = Math.max(1, Math.floor(ids.length * GEPA_FAILURE_CEILING));
    if (failures > allowed) {
      throw new Error(`classif-l4-gepa: route ${route} failed ${failures}/${ids.length} calls on ${step} (> ${allowed}): seat infrastructure, run stopped (a resume retries the failed calls)`);
    }
    return rows;
  };
  const byRoute = await runFamiliesParallel(groupRoutesByFamily(ctx.routes), runRoute);
  const out = Object.fromEntries(ids.map((id) => [id, {}]));
  for (const route of ctx.routes) byRoute.get(route).forEach((row, i) => { out[ids[i]][route] = row; });
  return out;
}

/** Case scores of evaluated rows: { itemId: { misses, noise, failures } }. */
export function scoreEvals(evals, refById, routes = GEPA_ROUTES) {
  const out = {};
  for (const [id, byRoute] of Object.entries(evals)) {
    out[id] = caseScore(refById.get(id).verdict, Object.fromEntries(routes.map((r) => [r, byRoute[r]?.failed ? { failed: true } : byRoute[r]?.pred])), routes);
  }
  return out;
}

const compactEvals = (evals) => Object.fromEntries(Object.entries(evals).map(([id, byRoute]) => [id,
  Object.fromEntries(Object.entries(byRoute).map(([route, r]) => [route, { failed: r.failed, pred: r.pred }]))]));

/** Per-route { misses, noise, failures, items } of compact evals. */
function perRouteCounts(evalsList, refById, routes) {
  const out = Object.fromEntries(routes.map((r) => [r, { misses: 0, noise: 0, failures: 0, items: 0 }]));
  for (const evals of evalsList) {
    for (const [id, byRoute] of Object.entries(evals)) {
      for (const route of routes) {
        const s = caseScore(refById.get(id).verdict, { [route]: byRoute[route]?.failed ? { failed: true } : byRoute[route]?.pred }, [route]);
        out[route].misses += s.misses;
        out[route].noise += s.noise;
        out[route].failures += s.failures;
        out[route].items++;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- run state

const candidateFile = (ctx, id) => path.join(ctx.runDir, 'candidates', `${id}.json`);

function saveCandidate(ctx, cand) {
  const f = candidateFile(ctx, cand.id);
  mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(f, JSON.stringify({ id: cand.id, origin: cand.origin, parents: cand.parents, iter: cand.iter, sha: cand.sha, text: cand.text, pareto: cand.pareto }), { mode: 0o600 });
}

function loadCandidate(ctx, id, sha = null) {
  const f = candidateFile(ctx, id);
  if (!existsSync(f)) return null;
  const c = JSON.parse(readFileSync(f, 'utf8'));
  if (sha && c.sha !== sha) throw new Error(`classif-l4-gepa: candidate ${id} on disk has another prompt sha (run state differs, start a new RUN)`);
  if (sha256(c.text) !== c.sha) throw new Error(`classif-l4-gepa: candidate ${id} text does not match its sha`);
  return { ...c, scores: scoreEvals(c.pareto, ctx.refById, ctx.routes) };
}

/** Known misses / noise cases of a candidate on D_feedback, from finished journal records only. */
export function knownErrors(journal, candId, prior = {}) {
  const misses = new Set(prior.misses ?? []);
  const noise = new Set(prior.noise ?? []);
  for (const rec of journal) {
    for (const [id, errs] of Object.entries(rec.parentErrors ?? {})) {
      if (id !== candId) continue;
      for (const x of errs.misses ?? []) misses.add(x);
      for (const x of errs.noise ?? []) noise.add(x);
    }
    if (rec.child?.id === candId) {
      for (const x of rec.child.misses ?? []) misses.add(x);
      for (const x of rec.child.noise ?? []) noise.add(x);
    }
  }
  return { misses: [...misses].sort(), noise: [...noise].sort() };
}

/** Seed prior: the misses of seed P<j> on its series-j tuning dev outputs (tuning files only). */
function seedPrior(home, version) {
  const dir = path.join(home, 'l4', `series-${version.slice(1)}`);
  const misses = new Set();
  let names = [];
  try { names = readdirSync(dir); } catch { return { misses: [] }; }
  for (const n of names.filter((x) => /^dev-.+\.jsonl$/.test(x))) {
    for (const r of shownMisses(readJsonlRecords(path.join(dir, n)))) misses.add(r.itemId);
  }
  return { misses: [...misses] };
}

function errorsOf(evals, refById, routes) {
  const scores = scoreEvals(evals, refById, routes);
  return { misses: Object.keys(scores).filter((id) => scores[id].misses > 0).sort(), noise: Object.keys(scores).filter((id) => scores[id].noise > 0).sort() };
}

async function proposal(ctx, iter, kind, prompt) {
  const rawDir = path.join(ctx.runDir, 'mut-raw');
  const phase = `${ctx.phase}.i${iter}-${kind}`;
  const tried = [];
  for (const [seat, suffix] of [[GEPA_MUTATOR, ''], [GEPA_RECONCILER, '-fallback']]) {
    try {
      ctx.budget.check(1);
      const text = parseProposal(await seatCall(ctx.home, ctx.callsLog, `${phase}${suffix}`, seat, prompt, ctx.seat, { rawDir }));
      if (text) return { text, seat };
      tried.push(`${seat}: no usable prompt`);
    } catch (e) {
      if (/run budget refused|pilot budget refused/.test(e.message)) throw e;
      tried.push(`${seat}: ${e.message}`);
    }
    ctx.log(`iteration ${iter} ${kind}: ${tried[tried.length - 1]}`);
  }
  throw new Error(`classif-l4-gepa: iteration ${iter} ${kind}: no usable prompt (${tried.join('; ')})`);
}

// ---------------------------------------------------------------- the loop

/**
 * Runs (or resumes) the GEPA loop and the final choice. `seat` replaces callSeat (tests).
 * Returns the repo manifest object.
 */
export async function runGepa({ home = classifHome(), repoClassif = classifDir(process.env), k, run = null, seed = null, maxCalls = DEFAULT_MAX_CALLS,
  maxIterations = null, finalTop = FINAL_TOP, concurrency = 2, seat = callSeat, log = (m) => process.stderr.write(`classif-l4-gepa: ${m}\n`) }) {
  if (k === undefined || k === null || !/^\d+$/.test(String(k))) throw new Error('classif-l4-gepa: SERIES=<k> (integer) required');
  const runId = run ?? `s${k}`;
  if (!/^[A-Za-z0-9-]+$/.test(runId)) throw new Error(`classif-l4-gepa: RUN must be [A-Za-z0-9-]+ (got ${runId})`);
  const seedValue = seed ?? `gepa-s${k}`;
  const outPrompt = path.join(repoClassif, 'l4', 'prompts', `P${k}.md`);
  // Refuse before any read of the halves or any paid call (optimise.mjs review N7 parity).
  if (existsSync(outPrompt)) throw new Error(`classif-l4-gepa: refusing to overwrite frozen prompt ${outPrompt}`);
  const runDir = privateDir(path.join(home, 'l4', `gepa-${runId}`));
  const phase = `l4-gepa-${runId}`;
  const budget = runBudget(home, { prefix: `${phase}.`, cap: Number(maxCalls) });
  const rows = readGepaTuning(home);
  const refById = new Map(rows.map((r) => [r.itemId, r]));
  const split = stratifiedSplit(rows, { seed: seedValue });
  const splitFile = path.join(runDir, 'split.json');
  if (existsSync(splitFile)) {
    const prev = JSON.parse(readFileSync(splitFile, 'utf8'));
    if (prev.seed !== split.seed || prev.sha256.feedback !== split.sha256.feedback || prev.sha256.pareto !== split.sha256.pareto) {
      throw new Error(`classif-l4-gepa: run ${runId} was split with seed ${prev.seed} over other tuning rows (start a new RUN)`);
    }
  } else writeFileSync(splitFile, JSON.stringify(split, null, 1), { mode: 0o600 });
  const ctx = { home, runDir, phase, budget, refById, routes: GEPA_ROUTES, codes: loadCodes(), seat, concurrency, log,
    callsLog: path.join(home, 'l2', 'calls.jsonl'), seatTmp: privateDir(path.join(home, 'l4', 'seat-tmp')) };
  const journalFile = path.join(runDir, 'iterations.jsonl');
  const journal = readJsonlRecords(journalFile).filter((r) => Number.isInteger(r.iter) && r.status);
  const finalReserve = split.feedback.length * ctx.routes.length;

  // Initial population P0..P4 on D_pareto (fails before any call when the cap cannot hold it).
  const seeds = SEED_PROMPTS.map((v) => {
    const text = readFileSync(path.join(repoClassif, 'l4', 'prompts', `${v}.md`), 'utf8');
    assertNoVerbatim(text, home, { what: `seed prompt ${v}` });
    return { id: v, origin: `seed:${v}`, parents: [], iter: null, text, sha: sha256(text) };
  });
  const initPlanned = seeds.reduce((s, c) => s + (loadCandidate(ctx, c.id, c.sha) ? 0 : uncachedCalls(ctx, c.sha, split.pareto)), 0);
  if (!budget.fits(initPlanned + finalReserve)) {
    throw new Error(`classif-l4-gepa: MAX_CALLS ${maxCalls} cannot hold the initial population (${initPlanned} calls) plus one final evaluation (${finalReserve}); remaining ${budget.remaining()}`);
  }
  const candidates = [];
  for (const s of seeds) {
    let c = loadCandidate(ctx, s.id, s.sha);
    if (!c) {
      log(`seed ${s.id}: evaluating on D_pareto (${split.pareto.length} cases × ${ctx.routes.length} routes)`);
      const evals = await evaluateCandidate(ctx, s, split.pareto, `seed-${s.id}`);
      saveCandidate(ctx, { ...s, pareto: compactEvals(evals) });
      c = loadCandidate(ctx, s.id, s.sha);
    }
    candidates.push(c);
  }
  for (const rec of journal.filter((r) => r.status === 'admitted').sort((a, b) => a.iter - b.iter)) {
    const c = loadCandidate(ctx, rec.child.id, rec.child.sha);
    if (!c) throw new Error(`classif-l4-gepa: journal admits ${rec.child.id} but its candidate file is missing`);
    candidates.push(c);
  }

  // Iterations.
  let stop = null;
  const doneIters = new Set(journal.map((r) => r.iter));
  for (let iter = 0; ; iter++) {
    if (doneIters.has(iter)) continue;
    if (maxIterations !== null && iter >= Number(maxIterations)) { stop = 'max-iterations'; break; }
    const rng = rngFor(split.seed, 'iteration', iter);
    const front = paretoFront(candidates, split.pareto);
    const kind = iter % CROSSOVER_EVERY === CROSSOVER_EVERY - 1 && front.length >= 2 ? 'crossover' : 'mutation';
    const parentIds = [sampleFromFront(front, rng)];
    if (kind === 'crossover') parentIds.push(sampleFromFront(front, rng, { exclude: parentIds }));
    const parents = parentIds.map((id) => candidates.find((c) => c.id === id));
    const prior = (c) => (c.origin.startsWith('seed:') ? seedPrior(home, c.id) : {});
    const known = parents.map((c) => knownErrors(journal, c.id, prior(c)));
    const minibatch = selectMinibatch(split.feedback, { misses: known.flatMap((e) => e.misses), noise: known.flatMap((e) => e.noise) }, rng);
    const planned = parents.reduce((s, c) => s + uncachedCalls(ctx, c.sha, minibatch), 0) + MUTATION_CALLS_MAX
      + minibatch.length * ctx.routes.length + split.pareto.length * ctx.routes.length;
    if (!budget.fits(planned + finalReserve)) { stop = 'budget'; break; }
    log(`iteration ${iter} (${kind}): parents ${parentIds.join('+')}, mini-batch ${minibatch.length}, ${budget.spent()} run calls spent`);
    const parentEvals = [];
    for (const c of parents) parentEvals.push(await evaluateCandidate(ctx, c, minibatch, `i${iter}-parent-${c.id}`));
    const parentTotals = parentEvals.map((e) => totalScore(scoreEvals(e, refById, ctx.routes), minibatch));
    const bestParent = parentTotals.reduce((b, t, i) => (compareScore(t, parentTotals[b]) < 0 ? i : b), 0);
    const rec = { iter, kind, at: new Date().toISOString(), parents: parentIds, minibatch,
      parentTotals: Object.fromEntries(parentIds.map((id, i) => [id, parentTotals[i]])),
      parentErrors: Object.fromEntries(parentIds.map((id, i) => [id, errorsOf(parentEvals[i], refById, ctx.routes)])) };
    const finish = (status, reason, extra = {}) => {
      Object.assign(rec, { status, reason, ...extra, runSpent: budget.spent() });
      appendJsonlRecord(journalFile, rec, { mode: 0o600 });
      journal.push(rec);
      log(`iteration ${iter}: ${status} (${reason})`);
    };
    // No child can beat a parent without miss nor noise on the mini-batch: skip the paid calls.
    if (parentTotals[bestParent].misses === 0 && parentTotals[bestParent].noise === 0) {
      finish('skipped', 'parent-without-error-on-minibatch');
      continue;
    }
    const prompt = kind === 'mutation'
      ? buildReflectionPrompt({ parentPrompt: parents[0].text, traces: buildTraces(parentEvals[0], refById, { routes: ctx.routes }) })
      : buildCrossoverPrompt({ promptA: parents[0].text, promptB: parents[1].text, labels: parentIds });
    const prop = await proposal(ctx, iter, kind, prompt);
    let checked;
    try {
      checked = await shingleCheckWithRepair({ home, callsLog: ctx.callsLog, k, fusedText: prop.text, reconciler: GEPA_RECONCILER,
        phaseBase: `${phase}.i${iter}`, what: `gepa candidate i${iter}`,
        call: (h, l, p, a, pr) => { budget.check(1); return seatCall(h, l, p, a, pr, seat, { rawDir: path.join(runDir, 'mut-raw') }); } });
    } catch (e) {
      if (!/^freeze refused:/.test(e.message)) throw e;
      finish('rejected', 'verbatim', { child: { id: `i${iter}`, seat: prop.seat } });
      continue;
    }
    const text = `${checked.text.trim()}\n`;
    const child = { id: `i${iter}`, origin: `${kind}:${parentIds.join('+')}`, parents: parentIds, iter, text, sha: sha256(text) };
    const childEvals = await evaluateCandidate(ctx, child, minibatch, `i${iter}-child`);
    const childTotal = totalScore(scoreEvals(childEvals, refById, ctx.routes), minibatch);
    const decision = admissionDecision(childTotal, parentTotals[bestParent]);
    const childRec = { id: child.id, sha: child.sha, seat: prop.seat, repairs: checked.repairs, minibatch: childTotal, ...errorsOf(childEvals, refById, ctx.routes) };
    if (!decision.admitted) { finish('rejected', decision.reason, { child: childRec }); continue; }
    const paretoEvals = await evaluateCandidate(ctx, child, split.pareto, `i${iter}-pareto`);
    saveCandidate(ctx, { ...child, pareto: compactEvals(paretoEvals) });
    const loaded = loadCandidate(ctx, child.id, child.sha);
    candidates.push(loaded);
    finish('admitted', decision.reason, { child: { ...childRec, paretoTotal: totalScore(loaded.scores, split.pareto) } });
  }
  log(`loop stopped (${stop}); ${candidates.length} candidates, ${budget.spent()} run calls spent`);

  // Final choice on the whole tuning half.
  const allIds = [...split.feedback, ...split.pareto].sort();
  const front = paretoFront(candidates, split.pareto);
  const ranked = front.map((f) => ({ c: candidates.find((x) => x.id === f.id), wins: f.wins }))
    .map((e, i) => ({ ...e, pareto: totalScore(e.c.scores, split.pareto), order: i }))
    .sort((a, b) => compareScore(a.pareto, b.pareto) || a.pareto.failures - b.pareto.failures || a.order - b.order);
  const finalists = [];
  const finalEvals = new Map();
  let evaluated = 0;
  for (const [rank, e] of ranked.entries()) {
    const base = { id: e.c.id, origin: e.c.origin, promptSha256: e.c.sha, wins: e.wins, rank, pareto: e.pareto };
    if (e.pareto.misses > 0) { finalists.push({ ...base, status: 'excluded', reason: 'misses-on-d-pareto' }); continue; }
    if (evaluated >= Number(finalTop)) { finalists.push({ ...base, status: 'not-evaluated', reason: 'final-top' }); continue; }
    if (!budget.fits(uncachedCalls(ctx, e.c.sha, split.feedback))) { finalists.push({ ...base, status: 'not-covered', reason: 'budget' }); continue; }
    const fb = await evaluateCandidate(ctx, e.c, split.feedback, `final-${e.c.id}`);
    finalEvals.set(e.c.id, fb);
    evaluated++;
    const total = totalScore({ ...e.c.scores, ...scoreEvals(fb, refById, ctx.routes) }, allIds);
    finalists.push({ ...base, status: 'evaluated', total, perRoute: perRouteCounts([e.c.pareto, compactEvals(fb)], refById, ctx.routes) });
  }
  const winner = finalChoice(finalists);
  const journalAll = readJsonlRecords(journalFile).filter((r) => Number.isInteger(r.iter) && r.status);
  const count = (pred) => journalAll.filter(pred).length;
  const manifest = { kind: 'l4-gepa', method: GEPA_METHOD, series: String(k), run: runId, createdAt: new Date().toISOString(),
    seed: split.seed, split: { feedback: split.feedback.length, pareto: split.pareto.length, feedbackShare: split.feedbackShare, strata: split.strata, sha256: split.sha256 },
    routes: ctx.routes, mutator: GEPA_MUTATOR, reconciler: GEPA_RECONCILER,
    objective: 'lexicographic: 0 miss (reference P/S predicted non_pertinent on any route, failed call = shown), then least noise (reference N predicted shown); P<->S not penalised',
    maxCalls: Number(maxCalls), callsSpent: budget.spent(), stop,
    iterations: { total: journalAll.length, mutation: count((r) => r.kind === 'mutation'), crossover: count((r) => r.kind === 'crossover'),
      admitted: count((r) => r.status === 'admitted'), rejected: count((r) => r.status === 'rejected'), skipped: count((r) => r.status === 'skipped') },
    population: candidates.map((c) => ({ id: c.id, origin: c.origin, promptSha256: c.sha, pareto: totalScore(c.scores, split.pareto) })),
    front: front.map((f) => ({ id: f.id, wins: f.wins })),
    finalists,
    result: winner
      ? { status: 'selected', candidate: winner.id, origin: winner.origin, version: `P${k}`, promptSha256: winner.promptSha256, total: winner.total }
      : { status: 'no-candidate', reason: 'no front candidate reached 0 miss on the whole tuning half (5 routes); no fallback' },
    trackNote: 'per-item tuning outputs, split ids and the iteration journal stay private in $CLASSIF_HOME/l4/gepa-<run>/; this manifest carries counts only' };
  mkdirSync(path.join(repoClassif, 'l4', 'manifests'), { recursive: true });
  if (winner) {
    const text = candidates.find((c) => c.id === winner.id).text;
    assertNoVerbatim(text, home, { what: `gepa winner ${winner.id}` });
    seedDevCache(ctx, { k, text, ids: allIds });
    writeFileSync(outPrompt, `${text.trim()}\n`);
  }
  writeFileSync(path.join(repoClassif, 'l4', 'manifests', `series-${k}-gepa.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  return manifest;
}

/**
 * Seeds the dev per-item cache of series k with the winner's cached rows (dev.mjs
 * readDevItemCache key: series, prompt sha of P<k>.md, route, item). Same prompt bytes as
 * devPrompt(P<k>.md), so `make classif-l4-dev SERIES=k` replays them without a paid call.
 * Existing files are never overwritten; failures were never cached.
 */
export function seedDevCache(ctx, { k, text, ids }) {
  const frozen = `${text.trim()}\n`;
  const sha = sha256(frozen);
  const dir = privateDir(path.join(ctx.home, 'l4', `series-${k}`));
  let seeded = 0;
  for (const route of ctx.routes) {
    for (const id of ids) {
      const row = readEvalCache(ctx, sha, route, id);
      if (!row || row.failed) continue;
      const ref = ctx.refById.get(id);
      const devRow = { itemId: id, ref: ref.code, refVerdict: ref.verdict, unresolved: false, pred: row.pred, failed: false, why: null,
        usage: row.usage ?? null, costUsd: row.costUsd ?? null };
      try {
        writeFileSync(path.join(dir, `dev-${route}.${id}.json`), JSON.stringify({ series: String(k), promptSha256: sha, route, itemId: id, row: devRow }), { flag: 'wx', mode: 0o600 });
        seeded++;
      } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
  return seeded;
}

export async function main(argv = process.argv.slice(2), { seat = callSeat } = {}) {
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? '' : null);
  const k = flag('--series') ?? process.env.SERIES;
  if (!k) { process.stderr.write('classif-l4-gepa: pass SERIES=<k>\n'); process.exit(2); }
  const num = (name, dflt) => {
    const v = flag(name);
    if (v === null || v === '') return dflt;
    if (!/^\d+$/.test(v)) throw new Error(`classif-l4-gepa: ${name} must be a non-negative integer (got ${v})`);
    return Number(v);
  };
  const manifest = await runGepa({ k, run: flag('--run') || null, seed: flag('--seed') || null, maxCalls: num('--max-calls', DEFAULT_MAX_CALLS),
    maxIterations: num('--max-iterations', null), finalTop: num('--final-top', FINAL_TOP), concurrency: num('--concurrency', 2), seat });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'gepa.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-gepa: ${err.stack}\n`); process.exit(1); });
}
