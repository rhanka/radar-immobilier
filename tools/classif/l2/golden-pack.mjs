#!/usr/bin/env node
// make classif-l2-golden-pack ENV=preprod — conductor-run, ONCE for phase A (plan v3 A2).
//
//  1. Unseals reference-c IN MEMORY with $REFERENCE_C_KEY (env only, never .env, never printed)
//     and checks every plaintext sha256 against docs/spec/reports/reference-c/README.md.
//  2. Opens the sealed evaluation set IN MEMORY with $CLASSIF_EVAL_KEY (executor role only,
//     one access-log entry per open; the plaintext sha256 must match the eval README).
//  3. Cross-checks the 113 S113 evaluation rows against the workbook evaluation partition.
//  4. Writes the annotators' private pack to $CLASSIF_HOME/pack-golden/ (mode 700/600, never
//     committed, deleted at the end of phase A): golden.md = the 113 sourced S113 rows
//     (verdict, reason code, observed pass, frozen input as served) + rows.json (row numbers).
//  5. Writes a label-free repo manifest (counts and hashes only).
//
// make classif-l2-golden-delete ENV=preprod removes the pack at the end of phase A.
import path from 'node:path';
import process from 'node:process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { keyFromEnv, readmeHashes, sha256, unseal } from '../lib/refc1.mjs';
import { parseWorkbook, partition } from '../lib/triage.mjs';
import { openEvalSet } from '../guard/evalset.mjs';
import { CLASSIF_DIR, REFC_DIR, classifHome, privateDir } from '../lib/paths.mjs';

export const PACK_FILES = { doc: 'golden.md', rows: 'rows.json', codes: 'codes.json' };

/**
 * Shared golden-pack loader (review §2): reads the conductor-built private pack, fail
 * closed when absent (run make classif-l2-golden-pack ENV=preprod first). Returns
 * { goldenPack (markdown), goldenRows (Set of row numbers) } for runPass crossreview.
 */
export function loadGoldenPack(home) {
  const doc = path.join(home, 'pack-golden', PACK_FILES.doc);
  const rows = path.join(home, 'pack-golden', PACK_FILES.rows);
  if (!existsSync(doc) || !existsSync(rows)) {
    throw new Error(`crossreview refused: golden pack absent (${doc}); run make classif-l2-golden-pack ENV=preprod first`);
  }
  return { goldenPack: readFileSync(doc, 'utf8'), goldenRows: new Set(JSON.parse(readFileSync(rows, 'utf8'))) };
}

/** Renders the private pack body from the sealed rows (verdict, code, pass, frozen input). */
export function renderPack(inputs, expected) {
  const byId = new Map(expected.map((e) => [e.evalId, e]));
  const rows = inputs.map((i) => ({ ...i, ...(byId.get(i.evalId) ?? {}) }));
  const body = [`# Golden pack — Steve's triage 2026-09-21 (S113, precedent only)`,
    ``,
    `113 sourced rows: verdict, reason code, observed pass, frozen input as served. Precedence:`,
    `item text > code definitions > guide > golden analogy. NEVER copy a golden excerpt into a`,
    `vote quote or reason: cite the row number with resemblance AND difference.`,
    ``,
    ...rows.flatMap((r) => [
      `## row ${r.lineNo} — ${r.evalId}`,
      ``,
      `- verdict: ${r.verdict}`,
      `- code: ${r.code}`,
      `- pass: ${r.pass}`,
      `- city: ${r.citySlug}`,
      `- input sha256: ${r.inputSha256 ?? 'none'}`,
      ``,
      `### frozen input`,
      ``,
      r.input ?? '_no node found in the graph (scored as execution-failure or excluded per Annex M)_',
      ``,
    ])].join('\n');
  return { body, rowNos: rows.map((r) => r.lineNo).sort((a, b) => a - b) };
}

export async function main(argv = process.argv.slice(2)) {
  const home = classifHome();
  const packDir = path.join(home, 'pack-golden');
  if (argv.includes('--delete')) {
    rmSync(packDir, { recursive: true, force: true });
    if (existsSync(packDir)) throw new Error(`${packDir} still exists after delete`);
    process.stdout.write(`${JSON.stringify({ deleted: packDir })}\n`);
    return { deleted: packDir };
  }
  if (existsSync(packDir)) throw new Error(`refusing to overwrite existing pack: ${packDir} (delete it first at the end of phase A)`);
  // 1. Reference-c in memory, hashes checked.
  const refKey = keyFromEnv('REFERENCE_C_KEY');
  const refReadme = readFileSync(path.join(REFC_DIR, 'README.md'), 'utf8');
  const expectedRef = readmeHashes(refReadme);
  const open = (name) => {
    const plain = unseal(refKey, readFileSync(path.join(REFC_DIR, `${name}.sealed`)));
    if (sha256(plain) !== expectedRef.get(`${name}.sealed`)) throw new Error(`${name}: plaintext sha256 differs from reference-c/README.md`);
    return plain;
  };
  const wb = parseWorkbook(open('reference-c.xlsx'));
  const { evaluation } = partition(wb.rows);
  // 2. Sealed evaluation set in memory (executor role, access logged, hashes checked inside).
  const { inputs, expected } = openEvalSet({ purpose: 'golden-pack-phase-A', env: process.env });
  // 3. Cross-check: 113 rows, same line numbers as the workbook evaluation partition.
  const want = new Set(evaluation.map((r) => r.lineNo));
  const got = new Set(expected.map((e) => e.lineNo));
  if (expected.length !== 113 || inputs.length !== 113) throw new Error(`golden pack refused: ${expected.length} expected / ${inputs.length} inputs rows (want 113/113)`);
  if (want.size !== got.size || [...want].some((n) => !got.has(n))) throw new Error('golden pack refused: sealed rows do not match the workbook evaluation partition');
  // 4. Private pack (mode 700/600, never committed).
  const { body, rowNos } = renderPack(inputs, expected);
  privateDir(packDir);
  writeFileSync(path.join(packDir, PACK_FILES.doc), body, { mode: 0o600 });
  writeFileSync(path.join(packDir, PACK_FILES.rows), `${JSON.stringify(rowNos)}\n`, { mode: 0o600 });
  // Row numbers → Steve code/verdict for the golden-set-conflict cause class (private, never committed).
  writeFileSync(path.join(packDir, PACK_FILES.codes), `${JSON.stringify(Object.fromEntries(expected.map((e) => [e.lineNo, { code: e.code, verdict: e.verdict }])) )}\n`, { mode: 0o600 });
  // 5. Label-free repo manifest.
  const manifest = {
    kind: 'golden-pack', createdAt: new Date().toISOString(), llmCalls: 0, rows: 113,
    packSha256: sha256(Buffer.from(body)), rowNumbers: rowNos,
    sources: { workbookLines: evaluation.length, sealedInputs: inputs.length, sealedExpected: expected.length },
    lifecycle: 'private to phase A annotators; delete with make classif-l2-golden-delete at the end of phase A',
  };
  mkdirSync(path.join(CLASSIF_DIR, 'l2', 'manifests'), { recursive: true });
  writeFileSync(path.join(CLASSIF_DIR, 'l2', 'manifests', 'golden-pack.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'golden-pack.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-golden-pack: ${err.stack}\n`); process.exit(1); });
}
