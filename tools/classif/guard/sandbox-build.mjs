#!/usr/bin/env node
// make classif-sandbox-build DIR=<sandbox> ENV=preprod — fingerprint scanner (plan §C.4).
// Refuses (exit 1) any file of a sandbox (pack for annotators/optimisers, scraped complements…)
// that hits a salted fingerprint list: evaluation-set node ids, exposed docShas, exposed city slugs
// (1–6 word n-grams of the text), exposed bylaw numbers, 12-word shingles of evaluation inputs.
// Prints file names and hit counts only, never the matched text.
import path from 'node:path';
import process from 'node:process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { scanShared } from '../lib/fingerprint.mjs';
import { classifHome } from '../lib/paths.mjs';
import { loadFingerprints } from '../lib/draw.mjs';

/** Sandbox refusal scan: delegates to the single shared guard scanner (no drift). */
export function scanFile(guard, text) {
  return scanShared(guard.salt, guard.fps, text);
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function scanDir(dir, guard) {
  const report = [];
  for (const file of walk(dir)) {
    const hits = scanFile(guard, readFileSync(file, 'utf8'));
    const total = Object.values(hits).reduce((a, b) => a + b, 0);
    report.push({ file: path.relative(dir, file), total, hits });
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('guard', 'sandbox-build.mjs'))) {
  const dir = process.argv[2];
  const guard = loadFingerprints(classifHome());
  if (!dir || !guard) {
    process.stderr.write('classif-sandbox-build: DIR and guard fingerprints (make classif-guard-unseal) are required\n');
    process.exit(2);
  }
  const report = scanDir(path.resolve(dir), guard);
  const bad = report.filter((r) => r.total > 0);
  for (const r of bad) process.stdout.write(`REFUSED ${r.file} ${JSON.stringify(r.hits)}\n`);
  process.stdout.write(`[classif-sandbox-build] ${report.length} files, ${bad.length} refused\n`);
  process.exit(bad.length ? 1 : 0);
}
