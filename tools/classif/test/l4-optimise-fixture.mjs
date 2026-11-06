// Shared hermetic fixture of the L4 optimise seat-override tests (not a test file itself):
// temp repo + temp CLASSIF_HOME tuning materials, mock sealed set, in-process fake seat.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPAIR_INSTRUCTION } from '../l4/optimise.mjs';
import { buildFingerprints } from '../lib/fingerprint.mjs';
import { initTempRepo, writeRepoFile } from './hermetic-helpers.mjs';

export const K = '7';
export const SALT = 'override-salt';
export const SEALED_A = 'the fictional quarry hamlet council adopted bylaw changes allowing triplex dwellings beside the northern orchard lane today';
export const SEALED_B = 'an imaginary lakeside borough rejected every request to convert its heritage granary into rental apartments last winter season';
export const RULES = 'Classify each municipal regulatory item by the registry code that best describes its densification effect. '
  + 'Return one JSON object per item with verdict, code, ambiguous and citation. The verdict is the registry partition of the code. ';
export const CLEAN1 = `${RULES}Prefer the most specific code when several apply.`;
export const CLEAN2 = `${RULES}When a change only renames a zone without altering permitted uses, answer the non pertinent code.`;
export const DIRTY = `${RULES}Rule 0: a typical case reads as follows: ${SEALED_A}.`;
export const OPT = 'You improve';
export const REC = 'You fuse';
export const OVERRIDE = ['--optimisers', 'astra-max,opus-5.5-max', '--reconciler', 'opus-5.5-max'];
export const MATERIALS = {
  tuningRef: [{ itemId: 'it-1', code: 'P-X', verdict: 'pertinent' }],
  tuningOutputs: { r1: [{ itemId: 'it-1', ref: 'P-X', refVerdict: 'pertinent', pred: { code: 'P-X', verdict: 'pertinent' } }] },
  errors: {},
  aggregates: { r1: { recall: 0.5 } },
  currentPrompt: `${RULES}\n`,
};
// What main() hands buildOptimiserPrompt for the fixture: the series-K dev manifest is the
// only one on disk, so the baseline is the current series (no baseline prompt text).
export const MATERIALS_SENT = { ...MATERIALS, baselinePrompt: { series: Number(K), version: `P${K}`, best: 0.5, recall: { r1: 0.5 }, text: null } };

export function setup(home) {
  const repo = initTempRepo();
  process.env.CLASSIF_REPO = repo;
  writeRepoFile(repo, `tools/classif/l4/prompts/P${K}.md`, MATERIALS.currentPrompt);
  writeRepoFile(repo, `tools/classif/l4/manifests/series-${K}-dev.json`, JSON.stringify({ routes: ['r1'], aggregates: MATERIALS.aggregates }));
  const put = (rel, body) => { mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); writeFileSync(path.join(home, rel), body); };
  put('l3b/reference-d.jsonl', `${JSON.stringify({ itemId: 'it-1', half: 'tuning', status: 'resolved', code: 'P-X', verdict: 'pertinent' })}\n`);
  put(`l4/series-${K}/dev-r1.jsonl`, `${JSON.stringify(MATERIALS.tuningOutputs.r1[0])}\n`);
  put(`l4/series-${K}/errors.json`, '{}');
  put('guard/salt', `${SALT}\n`);
  put('guard/fingerprints.json', JSON.stringify(buildFingerprints(SALT, { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: [SEALED_A, SEALED_B] })));
  return repo;
}

/** In-process fake seat for every label: optimiser → CLEAN1, reconciliation → `reconcile`, repair → CLEAN2. */
export function fakeSeat({ reconcile = CLEAN2 } = {}) {
  const seen = [];
  const seat = async (annotator, prompt) => {
    seen.push({ annotator, prompt });
    if (prompt.startsWith(OPT)) return { code: 0, text: CLEAN1, latencyMs: 1 };
    if (prompt.startsWith(REC)) return { code: 0, text: reconcile, latencyMs: 1 };
    assert.ok(prompt.startsWith(REPAIR_INSTRUCTION), 'unknown prompt kind');
    return { code: 0, text: CLEAN2, latencyMs: 1 };
  };
  const kind = (p) => (p.startsWith(OPT) ? 'opt' : p.startsWith(REC) ? 'rec' : 'repair');
  return { seat, seen, byKind: (k) => seen.filter((s) => kind(s.prompt) === k) };
}

export const manifestFile = (repo) => path.join(repo, 'tools', 'classif', 'l4', 'manifests', `series-${K}-optimise.json`);
export const callsLog = (home) => path.join(home, 'l2', 'calls.jsonl');
