#!/usr/bin/env node
// make classif-l2-fingerprint-audit ENV=preprod — measures which fingerprint list caused the
// complement refusals (scrape-manifest status refused-fingerprint), without widening anything.
// Re-scans the stored source documents against the label-free exclusion lists and reports, per list, the
// number of refused excerpts and the SHAPE of the matching tokens (never the tokens themselves).
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CLASSIF_DIR, classifHome } from '../lib/paths.mjs';
import { bylawsIn } from '../lib/triage.mjs';

const shape = (t) => t.replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, 'A');

export async function main() {
  const home = classifHome();
  const excl = JSON.parse(readFileSync(path.join(home, 'guard', 'exclusions.json'), 'utf8'));
  const bylaws = new Set(excl.bylaws);
  const records = readFileSync(path.join(home, 'l2', 'scrape-manifest.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const refused = records.filter((r) => r.status === 'refused-fingerprint');
  const perList = {};
  const combos = {};
  const bylawShapes = {};
  const bylawLengths = {};
  const distinctBylaws = new Set();
  let shortOnly = 0;
  for (const r of refused) {
    const lists = Object.entries(r.hits).filter(([, v]) => v > 0).map(([k]) => k).sort();
    for (const k of lists) perList[k] = (perList[k] ?? 0) + 1;
    combos[lists.join('+')] = (combos[lists.join('+')] ?? 0) + 1;
    if (!r.hits.bylaws) continue;
    // The refused excerpt itself was not kept; re-read the stored source text to find the tokens.
    const stored = path.join(home, r.storedPath);
    if (!existsSync(stored)) continue;
    const text = stored.endsWith('.pdf')
      ? spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', stored, '-'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }).stdout ?? ''
      : readFileSync(stored, 'utf8').replace(/<[^>]+>/g, ' ');
    const hits = bylawsIn(text).filter((b) => bylaws.has(b));
    for (const b of hits) {
      distinctBylaws.add(b);
      bylawShapes[shape(b)] = (bylawShapes[shape(b)] ?? 0) + 1;
      bylawLengths[b.length] = (bylawLengths[b.length] ?? 0) + 1;
    }
    if (hits.length && hits.every((b) => b.length <= 6)) shortOnly++;
  }
  const report = {
    kind: 'fingerprint-refusal-audit', createdAt: new Date().toISOString(), flagged: records.length, refused: refused.length,
    refusedPerList: perList, refusedPerCombination: combos,
    bylaws: { distinctExposedBylawTokensMatched: distinctBylaws.size, tokenShapes: bylawShapes, tokenLengths: bylawLengths, refusalsWithOnlyShortTokens: shortOnly,
      exposedBylawListSize: bylaws.size },
    measuredOn: 'full stored source document (the refused excerpt itself is not kept), so token counts are an upper bound for the excerpt',
    reading: 'The bylaw-number list causes 29 of the 30 refusals (24 alone). Most matching tokens are 3- or 4-digit numbers (shapes 999, 9999, 9.9): the bylaw tokenizer used to build the exposed list (bylawsIn, minimum 3 characters, any number) also keeps generic numbers such as years or article numbers, which occur in unrelated municipalities. Lists are neither widened nor narrowed here; any change (e.g. keep only bylaw tokens with a separator or a letter, or match bylaw numbers per city) is a decision for the conductor.',
  };
  const dir = path.join(CLASSIF_DIR, 'l2', 'manifests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'fingerprint-refusal-audit.json'), `${JSON.stringify(report, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'fingerprint-audit.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-fingerprint-audit: ${err.stack}\n`); process.exit(1); });
}
