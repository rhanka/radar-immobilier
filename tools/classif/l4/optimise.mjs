#!/usr/bin/env node
// make classif-l4-optimise SERIES=<k> ENV=preprod — prompt tuning (plan v3 C/D, review §A-2a).
//
// Inputs (tuning half ONLY): tuning-half reference rows, per-route tuning outputs and errors,
// tuning aggregates. NEVER the blind half, its inputs, its outputs, its aggregates, the sealed
// files, or the key: buildOptimiserPrompt() takes exactly the tuning materials and THROWS on
// any blind key (fail-closed firewall, covered by the unit test).
//
// Two max optimisers (muse-wonder-max, opus-5.5-max) each propose P(k+1); one reconciliation
// round (muse-wonder-max) fuses both proposals into a SINGLE common prompt. The frozen prompt
// is shingle-checked (no verbatim golden excerpt, review §C) before it lands in
// tools/classif/l4/prompts/P<k+1>.md; its sha is recorded in the repo manifest. The conductor
// commits the frozen prompt (freeze + commit before the blind run).
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROUTES, callSeat, parseJsonObject } from '../run-seat.mjs';
import { appendJsonlRecord, parseJsonlTolerant } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, classifHome, privateDir } from '../lib/paths.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';
import { check as budgetCheck } from '../lib/budget.mjs';

export const OPTIMISERS = ['muse-wonder-max', 'opus-5.5-max'];
export const TUNING_KEYS = ['tuningRef', 'tuningOutputs', 'errors', 'aggregates', 'currentPrompt'];

/**
 * Optimiser prompt from the tuning materials ONLY. Any blind-half key throws: nothing from
 * the blind half ever enters an optimiser input (plan v3 D3).
 */
export function buildOptimiserPrompt(materials) {
  const blindKeys = Object.keys(materials).filter((k) => !TUNING_KEYS.includes(k) || /blind/i.test(k));
  if (blindKeys.length) throw new Error(`optimiser firewall: refusing blind material (${blindKeys.join(',')})`);
  const { tuningRef, tuningOutputs, errors, aggregates, currentPrompt } = materials;
  return `You improve a municipal regulatory classification prompt for a residential densification radar (Québec).
You see ONLY the tuning half: ${tuningRef.length} tuning reference rows (expected code and verdict per item, unresolved rows excluded from scoring), the tuning outputs and errors of the evaluated routes, and the tuning aggregates (Annex M metrics). The blind half exists but you will NEVER see it: do not ask for it, do not guess its content.

Current prompt P (frozen):
---
${currentPrompt.trim()}
---

Tuning reference (item_id, expected code/verdict):
${tuningRef.map((r) => `- ${r.itemId}: ${r.code} (${r.verdict})`).join('\n')}

Tuning aggregates per route (Annex M shown recall/precision, failures, cost):
${JSON.stringify(aggregates, null, 1)}

Tuning outputs per route (item_id, expected code/verdict → predicted code/verdict, first 40 per route):
${Object.entries(tuningOutputs).map(([route, list]) => `## ${route}\n${list.slice(0, 40).map((o) => `- ${o.itemId}: ${o.ref} (${o.refVerdict}) → ${o.pred?.code ?? 'FAILED'} (${o.pred?.verdict ?? o.why ?? 'failed'})`).join('\n')}`).join('\n\n')}

Tuning errors per route (item_id, expected → predicted, failures and code errors included, first 60 per route):
${Object.entries(errors).map(([route, list]) => `## ${route}\n${list.slice(0, 60).map((e) => `- ${e.itemId}: ${e.ref} (${e.refVerdict}) → ${e.predCode ?? e.pred ?? 'FAILED'} (${e.pred ?? e.why ?? ''})${e.failed ? ' [failure]' : ''}`).join('\n')}`).join('\n\n')}

Propose the FULL next prompt P(k+1): same task, same answer schema (one JSON object per item: verdict, code, ambiguous, citation; verdict = registry partition of the code), improved ONLY from the tuning evidence above. General rules, never item-specific tricks, never a copied tuning example. Return ONLY the prompt text, no prose, no fences.`;
}

export function buildReconciliationPrompt(proposals) {
  return `You fuse two candidate classification prompts into ONE single common prompt. Both candidates address the same task (municipal regulatory items, verdict+code JSON per item, verdict = registry partition of the code). Keep every improvement both agree on; when they disagree, keep the rule best supported by the tuning evidence quoted in the candidates, never both variants. Output the single fused prompt ONLY: full text, no prose, no fences, no tuning example copied verbatim.

## Candidate A (muse-wonder-max)
---
${proposals[0].trim()}
---

## Candidate B (opus-5.5-max)
---
${proposals[1].trim()}
---`;
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

// Review §8: optimiser calls cached like amend cachedCall — a crash never repays a
// returned proposal (keyed by prompt sha256).
async function seatCall(home, callsLog, phase, annotator, prompt) {
  const key = sha256(prompt).slice(0, 16);
  const file = path.join(home, 'l4', 'opt-raw', `${phase}.${annotator}.${key}.json`);
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    if (c.promptSha256 === sha256(prompt) && typeof c.text === 'string') return c.text;
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: true, phase, annotator });
  const r = await callSeat(annotator, prompt, { base: privateDir(path.join(home, 'l4', 'seat-tmp')), timeoutMs: 3600000 });
  appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase, annotator, exitCode: r.code,
    latencyMs: r.latencyMs, usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null });
  if (r.code !== 0) throw new Error(`optimiser ${annotator} failed with seat exit ${r.code}`);
  writeFileSync(file, JSON.stringify({ promptSha256: sha256(prompt), text: r.text }), { mode: 0o600 });
  return r.text;
}

export async function main(argv = process.argv.slice(2)) {
  const k = argv.includes('--series') ? argv[argv.indexOf('--series') + 1] : process.env.SERIES;
  if (!k) { process.stderr.write('classif-l4-optimise: pass SERIES=<k>\n'); process.exit(2); }
  const deferred = argv.includes('--deferred') ? argv[argv.indexOf('--deferred') + 1].split(',').filter(Boolean) : [];
  const optimisers = OPTIMISERS.filter((o) => !deferred.includes(o));
  if (optimisers.length < 2) { process.stderr.write('classif-l4-optimise: refusing with fewer than 2 optimisers (single-author prompts break the reconciliation rule)\n'); process.exit(2); }
  const home = classifHome();
  const dir = path.join(home, 'l4', `series-${k}`);
  const currentPrompt = readFileSync(path.join(CLASSIF_DIR, 'l4', 'prompts', `P${k}.md`), 'utf8');
  const ref = parseJsonlTolerant(readFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), 'utf8'));
  const tuningRef = ref.filter((r) => r.half === 'tuning' && r.status === 'resolved').map((r) => ({ itemId: r.itemId, code: r.code, verdict: r.verdict }));
  const devManifest = JSON.parse(readFileSync(path.join(CLASSIF_DIR, 'l4', 'manifests', `series-${k}-dev.json`), 'utf8'));
  const tuningOutputs = {};
  for (const route of devManifest.routes) {
    tuningOutputs[route] = parseJsonlTolerant(readFileSync(path.join(dir, `dev-${route}.jsonl`), 'utf8'));
  }
  const errors = JSON.parse(readFileSync(path.join(dir, 'errors.json'), 'utf8'));
  // Review N7: refuse the overwrite BEFORE any paid call or budget check — a frozen
  // P(k+1) must fail before burning optimiser calls (the cache softened the old order).
  const next = Number(k) + 1;
  const outPrompt = path.join(CLASSIF_DIR, 'l4', 'prompts', `P${next}.md`);
  if (existsSync(outPrompt)) throw new Error(`classif-l4-optimise: refusing to overwrite frozen prompt ${outPrompt}`);
  // D5: 2 proposals + 1 reconciliation = 3 calls.
  budgetCheck(home, optimisers.length + 1);
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  const prompt = buildOptimiserPrompt({ tuningRef, tuningOutputs, errors, aggregates: devManifest.aggregates, currentPrompt });
  const proposals = [];
  for (const o of optimisers) {
    const text = await seatCall(home, callsLog, `l4-opt-s${k}`, o, prompt);
    const parsed = parseProposal(text);
    if (!parsed) throw new Error(`optimiser ${o} returned no usable prompt (too short or JSON-only)`);
    proposals.push(parsed);
  }
  const fused = await seatCall(home, callsLog, `l4-opt-s${k}-reconcile`, 'muse-wonder-max', buildReconciliationPrompt(proposals));
  const fusedText = parseProposal(fused);
  if (!fusedText) throw new Error('reconciliation returned no usable prompt');
  // Review §C: no verbatim golden excerpt in any prompt — shingle check before the freeze.
  assertNoVerbatim(fusedText, home, { what: `prompt P${Number(k) + 1}` });
  writeFileSync(outPrompt, `${fusedText.trim()}\n`);
  const manifest = { kind: 'l4-optimise', series: k, next: `P${next}`, createdAt: new Date().toISOString(),
    optimisers, proposalSha256: proposals.map((p) => sha256(p)), promptSha256: sha256(`${fusedText.trim()}\n`),
    tuningItems: tuningRef.length, shingleCheck: 'pass (0 verbatim shingles from the sealed set)' };
  mkdirSync(path.join(CLASSIF_DIR, 'l4', 'manifests'), { recursive: true });
  writeFileSync(path.join(CLASSIF_DIR, 'l4', 'manifests', `series-${k}-optimise.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'optimise.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-optimise: ${err.stack}\n`); process.exit(1); });
}
