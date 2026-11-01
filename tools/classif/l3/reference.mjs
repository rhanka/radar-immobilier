#!/usr/bin/env node
// make classif-l3-reference ENV=preprod — L3 dev reference (plan §B-L3), 0 LLM call.
// Reference code per item = majority code of the 3 annotators after the last pass (provenance
// model_consensus); verdict = registry partition of that code. Partitions: dev-core (code majority,
// not flagged ambiguous by all 3) and dev-ambiguous (no code majority, or ambiguous 3/3; out of the
// objective). PV items: the shared act is checked by quote overlap (≥ 2 of 3 annotators cite the same
// passage). The sealed evaluation set is NOT opened: only its committed hashes are copied.
import path from 'node:path';
import process from 'node:process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, EVAL_DIR_DEFAULT, classifHome } from '../lib/paths.mjs';
import { readmeHashes } from '../lib/refc1.mjs';
import { words } from '../lib/fingerprint.mjs';
import { ANNOTATORS, loadCodes, loadDevItems } from '../l2/run.mjs';
import { latestVotes, loadComplements } from '../l2/converge.mjs';
import { locateQuote } from '../l2/annotation.mjs';

export function quotesOverlap(a, b) {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (!wa.size || !wb.size) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size) >= 0.5;
}

/** PV act agreement: true when at least 2 annotators cite the same passage (quote located
    in the item text, same page + ≥ 50 % overlap). An unlocated quote never matches, even
    when two absent quotes resemble each other. */
export function actMatched(item, votes) {
  const q = votes.filter((v) => v?.valid && v.quote).map((v) => { const loc = locateQuote(item.input, v.quote); return { quote: v.quote, page: loc.page, found: loc.found }; });
  for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) if (q[i].found && q[j].found && q[i].page === q[j].page && quotesOverlap(q[i].quote, q[j].quote)) return true;
  return false;
}

/** Highest converged pass (converge-passN.json) in the home: L3 reads the last one, not pass 1. */
export function lastConvergedPass(home) {
  const ns = readdirSync(path.join(home, 'l2')).filter((f) => /^converge-pass(\d+)\.json$/.test(f)).map((f) => Number(/^converge-pass(\d+)\.json$/.exec(f)[1]));
  if (!ns.length) throw new Error(`no converge-passN.json in ${path.join(home, 'l2')} (run make classif-l2-converge first)`);
  return Math.max(...ns);
}

/**
 * Whether an item's reference uses external evidence: a traced complement existed for it
 * AND its latest vote was cast in a reconcile pass (≥ 2), where complements are injected
 * as context. Pass-1-only references never use external evidence.
 */
export function refUsesExternalForItem(itemId, latest, complements) {
  if (!(complements.get(itemId)?.length)) return false;
  return ANNOTATORS.some((a) => (latest.get(a).get(itemId)?.pass ?? 1) > 1);
}

/** Reference rows from converged rows + latest votes (shared by the L3 step and the exit audit). */
export function buildReferenceRows({ items, codes, rows, latest, complements, signalStrata, pass }) {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  return rows.map((r) => {
    const it = byId.get(r.itemId);
    const votes = ANNOTATORS.map((a) => latest.get(a).get(r.itemId) ?? null);
    const code = r.codeMaj?.value ?? null;
    const partition = !r.codeMaj || r.ambiguous33 ? 'dev-ambiguous' : 'dev-core';
    return {
      itemId: r.itemId, kind: r.kind, code, verdict: code ? codes.get(code) : (r.verdictMaj?.value ?? null),
      codeVotes: r.codeMaj?.count ?? 0, verdictVotes: r.verdictMaj?.count ?? 0, partition,
      reasons: [...(!r.codeMaj ? ['no-code-majority'] : []), ...(r.ambiguous33 ? ['ambiguous-3of3'] : [])],
      provenance: 'model_consensus', refUsesExternal: refUsesExternalForItem(r.itemId, latest, complements), pass,
      pVotes: votes.filter((v) => v?.valid && v.verdict === 'pertinent').length,
      ...(r.kind === 'pv' ? { actMatched: actMatched(it, votes) } : {}),
      bprimePass: r.kind === 'signal' ? signalStrata.get(r.itemId)?.pass ?? null : null,
    };
  });
}

const count = (rows, key) => rows.reduce((m, r) => { const k = key(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});

/** Manifest-level external-evidence summary, computed from the reference rows. */
export function refExternalSummary(ref, lastPass, complements) {
  const items = ref.filter((r) => r.refUsesExternal).length;
  const share = ref.length ? items / ref.length : 0;
  const note = lastPass <= 1
    ? `No reconciliation pass ran (stop rule met after pass ${lastPass}): ${complements.size} items have a traced complement but no vote was cast with it. The immo-only ceiling is therefore not reduced by external evidence.`
    : `${items} of ${ref.length} reference rows decided in a reconcile pass with a traced complement available (${complements.size} items with a complement).`;
  return { items, share, note };
}

export async function main() {
  const home = classifHome();
  const items = loadDevItems(home);
  const codes = loadCodes();
  const lastPass = lastConvergedPass(home);
  const conv = JSON.parse(readFileSync(path.join(home, 'l2', `converge-pass${lastPass}.json`), 'utf8'));
  const { latest } = latestVotes(home, lastPass);
  const complements = loadComplements(home);
  const signalStrata = new Map(JSON.parse(readFileSync(path.join(CLASSIF_DIR, 'l0', 'manifests', 'signal-draw-manifest.json'), 'utf8')).items.map((i) => [i.itemId, i]));
  const ref = buildReferenceRows({ items, codes, rows: conv.rows, latest, complements, signalStrata, pass: lastPass });
  const body = `${ref.map((r) => JSON.stringify(r)).join('\n')}\n`;
  const outDir = path.join(home, 'l3');
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(outDir, 'dev-reference.jsonl'), body, { mode: 0o600 });

  const evalReadme = readFileSync(path.join(EVAL_DIR_DEFAULT, 'README.md'), 'utf8');
  const sealedPlain = readmeHashes(evalReadme);
  const sealedFiles = Object.fromEntries([...sealedPlain.keys()].map((f) => [f, { plaintextSha256: sealedPlain.get(f), sealedFileSha256: sha256(readFileSync(path.join(EVAL_DIR_DEFAULT, f))) }]));
  const core = ref.filter((r) => r.partition === 'dev-core');
  const amb = ref.filter((r) => r.partition === 'dev-ambiguous');
  const pv = ref.filter((r) => r.kind === 'pv');
  const P = ref.filter((r) => r.verdict === 'pertinent');
  const verdictBy = (rows) => count(rows, (r) => r.verdict ?? 'none');
  const devItemsSha = sha256(readFileSync(path.join(home, 'l0', 'dev-items.jsonl')));
  const manifest = {
    lot: 'L3', kind: 'dev-reference', createdAt: new Date().toISOString(), llmCalls: 0, fromPass: lastPass,
    provenance: 'model_consensus (3 annotators: muse-wonder-1.0 max, gemini-4-argon-high, opus-5.5 max; guide G0)',
    refUsesExternal: refExternalSummary(ref, lastPass, complements),
    partitions: {
      'dev-core': { items: core.length, signal: core.filter((r) => r.kind === 'signal').length, pv: core.filter((r) => r.kind === 'pv').length, codeVotes3: core.filter((r) => r.codeVotes === 3).length, codeVotes2: core.filter((r) => r.codeVotes === 2).length },
      'dev-ambiguous': { items: amb.length, noCodeMajority: amb.filter((r) => r.reasons.includes('no-code-majority')).length, ambiguous3of3: amb.filter((r) => r.reasons.includes('ambiguous-3of3')).length,
        both: amb.filter((r) => r.reasons.length === 2).length, note: 'out of the dev objective' },
    },
    pvActs: { items: pv.length, actMatched2of3: pv.filter((r) => r.actMatched).length, note: 'one annotation per PV item and annotator (no per-act annotation in this pilot): act agreement = at least 2 annotators cite the same passage (same page, ≥ 50 % word overlap)' },
    agreement: conv.metrics,
    codeCoverage: { devCore: count(core, (r) => r.code), codesPresent: new Set(core.map((r) => r.code)).size, codesInRegistry: codes.size },
    lowPertinent: {
      referenceVerdicts: { all: verdictBy(ref), devCore: verdictBy(core), devAmbiguous: verdictBy(amb), signal: verdictBy(ref.filter((r) => r.kind === 'signal')), pv: verdictBy(pv) },
      pertinentItems: P.map((r) => ({ kind: r.kind, partition: r.partition, code: r.code, codeVotes: r.codeVotes, bprimePass: r.bprimePass })),
      pertinentCodes: count(P, (r) => r.code),
      itemsWithAtLeastOnePVote: ref.filter((r) => r.pVotes >= 1).length, itemsWithTwoOrMorePVotes: ref.filter((r) => r.pVotes >= 2).length,
      pVotesPerAnnotator: Object.fromEntries(ANNOTATORS.map((a) => [a, [...latest.get(a).values()].filter((v) => v.valid && v.verdict === 'pertinent').length])),
      signalsByBprimePass: Object.fromEntries(['pass1', 'pass2', 'pass3'].map((p) => [p, verdictBy(ref.filter((r) => r.bprimePass === p))])),
      codesByBprimePass: Object.fromEntries(['pass1', 'pass2', 'pass3'].map((p) => [p, count(ref.filter((r) => r.bprimePass === p), (r) => r.code ?? 'no-majority')])),
      shownCodes: count(ref.filter((r) => r.verdict === 'a_surveiller'), (r) => r.code ?? 'no-majority'),
      facts: [
        'All 5 Pertinent are signals in B′ pass 2, in dev-core; none in B′ pass 1 (192 signals: S-PORTEE-FLOUE is the most frequent code there) and none among the 120 PVs.',
        'Guide G0 requires positive evidence of the three criteria for a P code and sends an unreadable scope or direction to an S code (asymmetry reserve); the served signal text rarely states scope, direction and capacity together.',
        'The dev pool excludes the 67 exposed cities; its P base rate is unknown (source-gap) and cannot be compared with Steve’s pass shares.',
      ],
      consequenceForL4: 'With 5 Pertinent in dev-core, "Pertinent masked" on dev cannot separate prompts: 0 masked out of 5 gives a 95 % Clopper-Pearson upper bound of about 52 %, and one masked item moves the rate by 20 points. The first criterion of the lexicographic dev objective would be decided by noise; precision on P∪S and the later criteria would decide in practice. The S113 evaluation (Steve’s labels, about 38 P) is unaffected.',
      options: [
        { id: 'A', title: 'Dev objective on shown items', change: 'Replace "Pertinent masked" by "shown masked" (reference P or S predicted N, n = 172 including dev-ambiguous S, 64 in dev-core) as the first dev criterion, consistent with Steve’s asymmetry reserve; keep Pertinent masked as a reported dev diagnostic and as the primary metric on S113 only.', cost: '0 LLM call; protocol amendment of L4 (Annex M) before series 0.' },
        { id: 'B', title: 'Additional P-oriented draw from the non-sealed pool', change: 'Seeded draw of extra signals from B′ pass 2 (where the 5 P are; 4,030 pool items, 96 drawn) and pass 1 regulatory instruments, same exclusions and fingerprint checks, annotated by the 3 annotators with G0 (L2 circuit).', cost: 'draw: 0 LLM call; annotation about 3 calls per 10 signals (e.g. 240 signals ≈ 72 calls); P yield unknown (5 P in 96 pass-2 signals so far ≈ 5 %).' },
      ],
    },
    hashes: {
      devItemsSha256: devItemsSha, devReferenceSha256: sha256(body),
      sealedTest: { readme: 'docs/spec/reports/classif-eval/README.md', files: sealedFiles, note: 'hashes copied from the committed README and computed on the encrypted files; the evaluation set was not opened' },
    },
    trackEvent: 'to be recorded by the conductor (single track writer) before L4: devReferenceSha256 + sealed test plaintext hashes above',
  };
  const repoDir = path.join(CLASSIF_DIR, 'l3', 'manifests');
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(path.join(repoDir, 'l3-reference.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l3', 'reference.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l3-reference: ${err.stack}\n`); process.exit(1); });
}
