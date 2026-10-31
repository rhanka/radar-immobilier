#!/usr/bin/env node
// make classif-l2-revalidate PASS=<n> ENV=preprod — re-runs `engram profile validate-extraction` on
// the extractions already saved for pass n (engram-work/runs/pass<n>/...) and rewrites the per-item
// validity of each lot file. No seat call: used when validation itself failed (e.g. the Engram deps
// volume was missing after a machine crash, issue `engram_failed`).
import path from 'node:path';
import process from 'node:process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { classifHome } from '../lib/paths.mjs';
import { validateExtraction } from '../lib/engram.mjs';
import { itemValidity } from './annotation.mjs';
import { ANNOTATORS, loadCodes, loadDevItems } from './run.mjs';

export const engramFailed = (validation) => (validation.issues ?? []).some((i) => i.code === 'engram_failed');

export async function main(argv = process.argv.slice(2)) {
  const n = Number(argv[argv.indexOf('--pass') + 1]);
  const onlyFailed = !argv.includes('--all');
  const home = classifHome();
  const work = path.join(home, 'l1', 'engram-work');
  const items = new Map(loadDevItems(home).map((i) => [i.itemId, i]));
  const codes = loadCodes();
  const stats = { checked: 0, rewritten: 0, stillFailed: 0, invalidItems: 0 };
  for (const a of ANNOTATORS) {
    const dir = path.join(home, 'l2', `pass${n}`, a);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const file = path.join(dir, f);
      const lot = JSON.parse(readFileSync(file, 'utf8'));
      if (onlyFailed && lot.engramChecked === true) continue;
      stats.checked++;
      const rel = path.join('runs', `pass${n}`, a, f);
      const extraction = JSON.parse(readFileSync(path.join(work, rel), 'utf8'));
      const validation = extraction.nodes.length ? validateExtraction(work, rel) : { valid: false, issues: [] };
      if (engramFailed(validation)) { stats.stillFailed++; continue; }
      const pairs = lot.annotations.map((an) => ({ item: items.get(an.itemId), answer: an.code === null ? null : { code: an.code } }));
      const validity = itemValidity(extraction, validation, pairs, codes);
      lot.annotations = lot.annotations.map((an, i) => ({ ...an, valid: validity[i].valid, issues: validity[i].issues }));
      lot.engramValid = validation.valid ?? false;
      lot.engramIssues = (validation.issues ?? []).length;
      lot.engramIssueCodes = [...new Set((validation.issues ?? []).map((x) => x.code))];
      lot.engramChecked = true;
      stats.invalidItems += lot.annotations.filter((x) => !x.valid).length;
      writeFileSync(file, JSON.stringify(lot, null, 1), { mode: 0o600 });
      stats.rewritten++;
    }
  }
  process.stdout.write(`${JSON.stringify(stats)}\n`);
  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'revalidate.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-revalidate: ${err.stack}\n`); process.exit(1); });
}
