#!/usr/bin/env node
// make classif-l1-guide ENV=preprod — guide G0 (plan §B-L1, last bullet): written by ONE fresh isolated
// Opus 5.5 max session (claude -p, no tools, no CLAUDE.md, empty cwd) from the allowed pack only:
// Steve's general criteria, the 28 code definitions (no count, no example), the output schema.
// Writes $CLASSIF_HOME/l1/pack/guide-G0.md (private) and the L1 manifest (hashes only) in the repo.
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { callSeat } from '../run-seat.mjs';
import { OUTPUT_SCHEMA } from '../l2/annotation.mjs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, classifHome, privateDir } from '../lib/paths.mjs';

export const G0_PROMPT = (criteria, definitions) => `You write the annotation guide G0 for three independent AI annotators who will classify municipal
regulatory items (Québec) for a residential densification radar, following the client Steve's criteria.

Inputs you may use (and nothing else):
1. Steve's general criteria (verbatim quotes):
${criteria.trim()}

2. The 28 reason codes with their definitions; each code belongs to one verdict (pertinent, a_surveiller,
non_pertinent), and the verdict of an annotation is always the verdict of its code:
${definitions.trim()}

3. The annotators' output schema (one entry per item):
${OUTPUT_SCHEMA}

Write guide G0 in Markdown, at most 1,200 words, that tells an annotator how to pick exactly one code per item:
- a decision procedure in a fixed order (scope and nature of the act, individual authorisation, agenda item vs
  decision, residential, direction of the change, effect on the capacity to build, stage), and how each outcome
  maps to codes;
- tie-break rules between neighbouring codes (e.g. S-RESTRICTIF vs N-RESTRICTIF, S-PLANIFIE vs P- codes,
  S-PORTEE-FLOUE vs S-INFO-MANQUANTE, N-ACCESSOIRE, V2-PRECEDENT);
- Steve's asymmetry reserve: when the direction or scope cannot be read, prefer a code that keeps the item shown;
- when to set "ambiguous" and which ambiguity_cause to give; absence of information is never evidence for N;
- the quote rule (verbatim, from the item text, the passage that decides the code).
Do not invent facts about real municipalities; illustrate only with clearly invented phrases if needed.
Return only the guide.`;

export async function main() {
  const home = classifHome();
  const packDir = privateDir(path.join(home, 'l1', 'pack'));
  const out = path.join(packDir, 'guide-G0.md');
  if (existsSync(out)) throw new Error(`${out} exists`);
  const criteria = readFileSync(path.join(packDir, 'criteria.md'), 'utf8');
  const definitions = readFileSync(path.join(packDir, 'codes-definitions.md'), 'utf8');
  const prompt = G0_PROMPT(criteria, definitions);
  let r;
  let calls = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Resume state: the raw answer is saved as soon as it returns and reused after a restart.
    const rawFile = path.join(home, 'l1', `guide-G0.raw.${sha256(prompt).slice(0, 16)}.a${attempt}.json`);
    if (existsSync(rawFile)) r = JSON.parse(readFileSync(rawFile, 'utf8'));
    else {
      calls++;
      r = await callSeat('opus-5.5-max', prompt, { base: privateDir(path.join(home, 'l1', 'seat-tmp')), timeoutMs: 3600000 });
      writeFileSync(rawFile, JSON.stringify(r), { mode: 0o600 });
    }
    if (r.code === 0 && String(r.text).trim().length > 800) break;
  }
  const guide = String(r.text ?? '').trim();
  if (guide.length <= 800) throw new Error(`guide G0 not produced (exit ${r.code}): ${String(r.stderrTail ?? '').slice(-300)}`);
  writeFileSync(out, `${guide}\n`, { mode: 0o600 });
  const manifestDir = path.join(CLASSIF_DIR, 'l1', 'manifests');
  mkdirSync(manifestDir, { recursive: true });
  const manifest = {
    lot: 'L1', kind: 'guide-G0', createdAt: new Date().toISOString(), author: 'opus-5.5-max (isolated claude -p)', calls,
    promptSha256: sha256(prompt), pack: { criteriaSha256: sha256(criteria), definitionsSha256: sha256(definitions) },
    guideG0Sha256: sha256(`${guide}\n`), guideWords: guide.split(/\s+/).length, latencyMs: r.latencyMs, usage: r.usage ?? null,
    note: 'Guide text and pack stay private ($CLASSIF_HOME/l1/pack): they derive from Steve\'s text.',
  };
  writeFileSync(path.join(manifestDir, 'guide-g0.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l1', 'guide-g0.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l1-guide: ${err.message}\n`); process.exit(1); });
}
