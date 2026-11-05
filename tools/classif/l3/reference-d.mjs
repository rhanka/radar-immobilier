#!/usr/bin/env node
// make classif-l3b-reference ENV=preprod — reference set D (plan v3 L3b, 0 model call).
//
// Per item: code and verdict (majority of the 3 annotators after the last pass), votes,
// label_provenance (D1: human_single / human_adjudicated / model_consensus / mixed;
// golden_precedent and external_evidence are EVIDENCE fields; unresolved is a STATUS),
// partitions core (resolved) / unresolved (no majority after the cap, or residual without
// resolution — neither scored nor in any denominator).
//
// Provenance rule: human_adjudicated when the item went through Chaperon consultation
// ($CLASSIF_HOME/l3b/adjudications.json); mixed when a majority voter cited a golden row;
// model_consensus otherwise. human_single is reserved for Chaperon-origin rows (e.g. S113),
// never produced for D.
//
// Requires the committed split (D2) and the frozen FINAL guide (the blind half is sealed
// only after its cross-review under the frozen guide). Seals the blind-half expected labels
// with CLASSIF_BLIND_KEY (REFC1, lib/blind.mjs guard); the private reference rows land in
// $CLASSIF_HOME/l3b/reference-d.jsonl (mode 600). Blind inputs stay in the frozen dev corpus.
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, classifHome, privateDir } from '../lib/paths.mjs';
import { sealBlindSet } from '../lib/blind.mjs';
import { ANNOTATORS, loadCodes, loadDevItems } from '../l2/run.mjs';
import { latestVotes, loadComplements } from '../l2/converge.mjs';
import { lastConvergedPass, refUsesExternalForItem } from './reference.mjs';

export function provenanceOf({ codeMaj, votes, adjudicated }) {
  if (adjudicated) return 'human_adjudicated';
  if (!codeMaj) return 'model_consensus';
  const majorityVoters = votes.filter((v) => v?.valid && v.code === codeMaj);
  if (majorityVoters.some((v) => (v.goldenPrecedent ?? []).length > 0)) return 'mixed';
  return 'model_consensus';
}

export function buildReferenceD({ rows, latest, complements, halves, adjudications, ambiguityCauses, pass, codes }) {
  return rows.map((r) => {
    const votes = ANNOTATORS.map((a) => latest.get(a).get(r.itemId) ?? null);
    const code = r.codeMaj?.value ?? null;
    const status = code ? 'resolved' : 'unresolved';
    const cited = [...new Set(votes.filter((v) => v?.valid && (!code || v.code === code)).flatMap((v) => v.goldenPrecedent ?? []))].sort((a, b) => a - b);
    return {
      itemId: r.itemId, kind: r.kind, code, verdict: code ? codes.get(code) ?? null : (r.verdictMaj?.value ?? null),
      votes: votes.map((v, i) => v ? { annotator: ANNOTATORS[i], valid: v.valid, code: v.code, verdict: v.verdict,
        ambiguous: v.ambiguous, cause: v.cause ?? null, goldenPrecedent: v.goldenPrecedent ?? [],
        labelProvenance: v.labelProvenance ?? null, pass: v.pass ?? null, guide: v.guide ?? null } : { annotator: ANNOTATORS[i], valid: false }),
      label_provenance: provenanceOf({ codeMaj: code, votes, adjudicated: adjudications.has(r.itemId) }),
      evidence: { golden_precedent: cited, external_evidence: refUsesExternalForItem(r.itemId, latest, complements) },
      status, cause: status === 'unresolved' ? ambiguityCauses.get(r.itemId) ?? 'unclassified' : null,
      partition: status === 'unresolved' ? 'unresolved' : 'core',
      half: halves.tuning.has(r.itemId) ? 'tuning' : halves.blind.has(r.itemId) ? 'blind' : 'unknown',
      pass,
    };
  });
}

export async function main(argv = process.argv.slice(2)) {
  const home = classifHome();
  const splitFile = path.join(CLASSIF_DIR, 'l3', 'manifests', 'split.json');
  if (!existsSync(splitFile)) { process.stderr.write('classif-l3b-reference: refusing without the committed split (run make classif-l3b-split ENV=preprod first)\n'); process.exit(2); }
  if (!existsSync(path.join(home, 'l1', 'pack', 'guide-FINAL.md'))) { process.stderr.write('classif-l3b-reference: refusing without the frozen guide (the blind half is sealed only after its cross-review under guide FINAL)\n'); process.exit(2); }
  const split = JSON.parse(readFileSync(splitFile, 'utf8'));
  const halves = { tuning: new Set(split.halves.tuning), blind: new Set(split.halves.blind) };
  const items = loadDevItems(home);
  const codes = loadCodes();
  const lastPass = lastConvergedPass(home);
  const conv = JSON.parse(readFileSync(path.join(home, 'l2', `converge-pass${lastPass}.json`), 'utf8'));
  const { latest, gaps, deferred } = latestVotes(home, lastPass);
  const complements = loadComplements(home);
  const adjFile = path.join(home, 'l3b', 'adjudications.json');
  const adjudications = new Set(existsSync(adjFile) ? Object.keys(JSON.parse(readFileSync(adjFile, 'utf8'))) : []);
  let causes = new Map();
  try {
    const amb = JSON.parse(readFileSync(path.join(home, 'l2', `ambiguity-pass${lastPass}.json`), 'utf8'));
    causes = new Map((amb.residuals ?? []).map((r) => [r.itemId, r.cause]));
  } catch { /* no ambiguity map: causes default to unclassified */ }
  const ref = buildReferenceD({ rows: conv.rows, latest, complements, halves, adjudications, ambiguityCauses: causes, pass: lastPass, codes });
  const l3bDir = privateDir(path.join(home, 'l3b'));
  const body = `${ref.map((r) => JSON.stringify(r)).join('\n')}\n`;
  writeFileSync(path.join(l3bDir, 'reference-d.jsonl'), body, { mode: 0o600 });
  // Seal the blind-half expected labels (ids + code + verdict only; inputs stay frozen).
  const blindRows = ref.filter((r) => r.half === 'blind').map((r) => ({ itemId: r.itemId, kind: r.kind, code: r.code, verdict: r.verdict, status: r.status, cause: r.cause }));
  const seal = sealBlindSet(blindRows, { home });
  const core = ref.filter((r) => r.partition === 'core');
  const unr = ref.filter((r) => r.partition === 'unresolved');
  const prov = {};
  for (const r of ref) prov[r.label_provenance] = (prov[r.label_provenance] ?? 0) + 1;
  const manifest = { kind: 'reference-d', createdAt: new Date().toISOString(), llmCalls: 0, fromPass: lastPass,
    deferred, gaps, halves: { tuning: ref.filter((r) => r.half === 'tuning').length, blind: blindRows.length },
    partitions: { core: core.length, unresolved: unr.length,
      unresolvedCauses: unr.reduce((m, r) => { m[r.cause ?? 'unclassified'] = (m[r.cause ?? 'unclassified'] ?? 0) + 1; return m; }, {}) },
    provenances: prov, adjudications: adjudications.size,
    hashes: { referenceD: sha256(body), blindPlain: seal.plainSha256, blindSealed: seal.sealedSha256 },
    externalEvidence: ref.filter((r) => r.evidence.external_evidence).length,
    trackEvent: 'to be recorded by the conductor (single track writer) before P0: referenceDSha256 + blind seal hashes above' };
  mkdirSync(path.join(CLASSIF_DIR, 'l3', 'manifests'), { recursive: true });
  writeFileSync(path.join(CLASSIF_DIR, 'l3', 'manifests', 'reference-d.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l3', 'reference-d.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l3b-reference: ${err.stack}\n`); process.exit(1); });
}
