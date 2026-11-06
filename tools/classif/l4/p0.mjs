#!/usr/bin/env node
// make classif-l4-p0 ENV=preprod — authors the series baseline P0 (plan v3 C/D, review §A-2a).
//
// P0 has no max-AI author: the builder authors it deterministically (0 model call) from the
// frozen FINAL guide, the 28 code definitions and Steve's criteria. It is the first evaluated
// prompt of series 0 and the optimiser input for P1. Shingle-checked (no verbatim golden
// excerpt, review §C) before it lands in tools/classif/l4/prompts/P0.md; the conductor commits
// it (freeze + commit before the tuning run).
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, classifHome } from '../lib/paths.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';

export function renderP0({ criteria, definitions, guide }) {
  return `You classify a municipal regulatory item for a residential densification radar (Québec).

For the item below, choose exactly ONE reason code of the registry \`reason_codes\`; the main
category (verdict) is the registry partition of that code and is never chosen separately.
Judge from the item text only. Precedence: item text > code definitions > guide. Quote the item
text verbatim (at most 300 characters) as the citation.

## Steve's criteria

${criteria.trim()}

## Reason code definitions

${definitions.trim()}

## Annotation guide (FINAL, frozen after phase-A cross-review)

${guide.trim()}

## Output

Return ONLY one JSON object, no prose: {"verdict":"pertinent|a_surveiller|non_pertinent","code":"<one reason code>","ambiguous":true|false,"citation":"<verbatim quote from the item text>"}
The verdict must be the partition of the code.
`;
}

export async function main() {
  const home = classifHome();
  // Review §11a: shared fail-closed FINAL guard (missing/corrupt manifest refuses).
  const { assertFinalGuide } = await import('../lib/freeze.mjs');
  assertFinalGuide(home);
  const packDir = path.join(home, 'l1', 'pack');
  const guideFile = path.join(packDir, 'guide-FINAL.md');
  const guide = readFileSync(guideFile, 'utf8');
  const criteria = readFileSync(path.join(packDir, 'criteria.md'), 'utf8');
  const definitions = readFileSync(path.join(packDir, 'codes-definitions.md'), 'utf8');
  const p0 = renderP0({ criteria, definitions, guide });
  // Review §C: no verbatim golden excerpt in any prompt — shingle check before the freeze.
  assertNoVerbatim(p0, home, { what: 'prompt P0' });
  const out = path.join(CLASSIF_DIR, 'l4', 'prompts', 'P0.md');
  // Review §11: never overwrite a frozen artefact.
  if (existsSync(out)) throw new Error(`classif-l4-p0: refusing to overwrite frozen prompt ${out}`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${p0.trim()}\n`);
  const manifest = { kind: 'l4-p0', createdAt: new Date().toISOString(), llmCalls: 0,
    author: 'builder template (deterministic, from guide FINAL + 28 definitions + criteria)',
    promptSha256: sha256(`${p0.trim()}\n`), shingleCheck: 'pass (0 verbatim shingles from the sealed set)' };
  mkdirSync(path.join(CLASSIF_DIR, 'l4', 'manifests'), { recursive: true });
  writeFileSync(path.join(CLASSIF_DIR, 'l4', 'manifests', 'p0.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l4', 'p0.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l4-p0: ${err.stack}\n`); process.exit(1); });
}
