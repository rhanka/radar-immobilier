// Freeze guard (review §C, §E-3): no verbatim golden excerpt in any guide or prompt.
// Before a guide amendment lands or a prompt is frozen, the candidate text is scanned against
// the sealed-set fingerprints (salted 12-word shingles of the evaluation inputs, which include
// the S113 rows the annotators consulted). Any shingle hit refuses the freeze: the precedent
// may be cited by row number, never copied. Fail closed when the guard material is absent.
import { requireFingerprints } from './draw.mjs';
import { scanText } from './fingerprint.mjs';

/** Throws when `text` shares a 12-word shingle with the sealed set. Returns the hit counts. */
export function assertNoVerbatim(text, home, { what = 'candidate' } = {}) {
  const fp = requireFingerprints(home);
  const hits = scanText(fp.salt, fp.fps, text);
  if (hits.shingles > 0) {
    throw new Error(`freeze refused: ${what} carries ${hits.shingles} verbatim 12-word shingle(s) from the sealed set (cite golden rows by number, never copy them)`);
  }
  return hits;
}
