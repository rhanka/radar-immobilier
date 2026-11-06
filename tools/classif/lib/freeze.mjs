// Freeze guard (review §C, §E-3): no verbatim golden excerpt in any guide or prompt.
// Before a guide amendment lands or a prompt is frozen, the candidate text is scanned against
// the sealed-set fingerprints (salted 12-word shingles of the evaluation inputs, which include
// the S113 rows the annotators consulted). Any shingle hit refuses the freeze: the precedent
// may be cited by row number, never copied. Fail closed when the guard material is absent.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { requireFingerprints } from './draw.mjs';
import { scanText } from './fingerprint.mjs';
import { sha256 } from './render.mjs';
import { classifDir } from './paths.mjs';
import process from 'node:process';

/** Throws when `text` shares a 12-word shingle with the sealed set. Returns the hit counts. */
export function assertNoVerbatim(text, home, { what = 'candidate' } = {}) {
  const fp = requireFingerprints(home);
  const hits = scanText(fp.salt, fp.fps, text);
  if (hits.shingles > 0) {
    throw new Error(`freeze refused: ${what} carries ${hits.shingles} verbatim 12-word shingle(s) from the sealed set (cite golden rows by number, never copy them)`);
  }
  return hits;
}

/**
 * Shared FINAL-guide guard (review §4 + §11a): the consumed guide-FINAL.md sha must match
 * the freeze manifest. Fail CLOSED: a missing, unparsable, or sha-less manifest refuses —
 * deleting or corrupting guide-freeze.json must never disable the check.
 * Consumed by reference-d, p0, chain --stage blind and the pass CLI.
 */
export function assertFinalGuide(home, { manifestFile = null } = {}) {
  const freezeFile = manifestFile ?? path.join(classifDir(process.env), 'l2', 'manifests', 'guide-freeze.json');
  const guideFile = path.join(home, 'l1', 'pack', 'guide-FINAL.md');
  if (!existsSync(guideFile)) throw new Error(`FINAL guide refused: ${guideFile} absent (freeze FINAL first)`);
  if (!existsSync(freezeFile)) throw new Error(`FINAL guide refused: freeze manifest ${freezeFile} absent (fail closed)`);
  let freeze;
  try {
    freeze = JSON.parse(readFileSync(freezeFile, 'utf8'));
  } catch (e) {
    throw new Error(`FINAL guide refused: freeze manifest ${freezeFile} unparsable (fail closed): ${e.message}`);
  }
  if (!freeze?.guideSha256 || typeof freeze.guideSha256 !== 'string') {
    throw new Error(`FINAL guide refused: freeze manifest ${freezeFile} carries no guideSha256 (fail closed)`);
  }
  const actual = sha256(readFileSync(guideFile, 'utf8'));
  if (actual !== freeze.guideSha256) {
    throw new Error('FINAL guide refused: guide-FINAL.md sha differs from the freeze manifest (re-freeze before sealing)');
  }
  return { guideSha256: actual, manifestFile: freezeFile };
}
