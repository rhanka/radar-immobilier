// Soft matching (owner decision 2026-09-18, after two contradictory reviews that converged, see
// the Fable and Astra reviews in the oracle-v3 report annex): two citations of the SAME act cut at
// different places. Rule, no floating threshold:
//   same frozen document, object key strictly equal (digit boundary: 2026-14 is never 2026-15 nor
//   2026-140), same stage, same page, and the two verbatim spans overlap by at least
//   MIN_OVERLAP_CHARS normalised characters (contract v9 normalisation, the anchor floor). Positions
//   are exact because every citation is grounded verbatim in the frozen text.
// ROUGE-L (longest common subsequence F1 on normalised word tokens) is still computed, as a
// DIAGNOSTIC only: it never merges and never credits (Fable review: same-act pairs overlap by 58+
// characters while their ROUGE-L spreads 0.55-0.94; distinct acts on the same lot reach 0.94 with
// no overlap at all).
// Known limit (Astra review): two DISTANT passages proving the same act are not joined by the
// intervals; those cases stay in arbitration, deliberately.

import { locate, normalizeV9, objectKey } from "./oracle-v3-lib.mjs";

export const MIN_OVERLAP_CHARS = 12;
export const ROUGE_DIAGNOSTIC_THRESHOLD = 0.5;

export const tokens = (text) => String(text ?? "").normalize("NFKC").normalize("NFD")
  .replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function rougeL(left, right) {
  const a = tokens(left); const b = tokens(right);
  if (!a.length || !b.length) return 0;
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
    }
    previous = row;
  }
  const lcs = previous[b.length];
  if (!lcs) return 0;
  const precision = lcs / b.length; const recall = lcs / a.length;
  return (2 * precision * recall) / (precision + recall);
}

// Object key found in a text: both sides through objectKey (compact: "Règlement no 2026-14" ->
// "202614", "lot 5 191 695" -> "5191695"); no digit may be glued before or after the key.
export function identifierInText(unit, texts) {
  const key = objectKey(unit.objet);
  if (!key) return false;
  return texts.some((text) => {
    const haystack = objectKey(text);
    for (let at = haystack.indexOf(key); at >= 0; at = haystack.indexOf(key, at + 1)) {
      const before = haystack[at - 1]; const after = haystack[at + key.length];
      const glued = (edge, char) => /\d/u.test(edge) && char !== undefined && /\d/u.test(char);
      if (!glued(key[0], before) && !glued(key.at(-1), after)) return true;
    }
    return false;
  });
}

// Same stage and same non-empty object key (strict equality, never "contained").
export function sameIdentity(left, right) {
  const key = objectKey(left.objet);
  return Boolean(key) && key === objectKey(right.objet) && left.stage === right.stage;
}

// Raw span of a citation on its page: the grounded offsets when present, else the verbatim
// citation located again in the frozen page text (v9 normalisation).
export function unitSpan(unit, pages) {
  const pageText = pages[unit.page - 1];
  if (typeof pageText !== "string") return null;
  if (Number.isInteger(unit.spanStart) && Number.isInteger(unit.spanEnd)) return { start: unit.spanStart, end: unit.spanEnd };
  const found = typeof unit.citation === "string" ? locate(pageText, unit.citation) : null;
  return found ? { start: found.start, end: found.end } : null;
}

// Overlap of two raw spans of the same page, in normalised characters.
export function overlapChars(pageText, left, right) {
  if (!left || !right) return 0;
  const start = Math.max(left.start, right.start); const end = Math.min(left.end, right.end);
  return end > start ? normalizeV9(pageText.slice(start, end)).length : 0;
}

export function spanOverlap(left, right, pages) {
  if (left.page !== right.page) return 0;
  return overlapChars(pages[left.page - 1] ?? "", unitSpan(left, pages), unitSpan(right, pages));
}

export const softEquivalent = (left, right, pages) =>
  sameIdentity(left, right) && spanOverlap(left, right, pages) >= MIN_OVERLAP_CHARS;

// Diagnostic twin, never used to decide.
export const rougeEquivalent = (left, right) =>
  sameIdentity(left, right) && rougeL(left.citation, right.citation) >= ROUGE_DIAGNOSTIC_THRESHOLD;

export function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
  const bins = Array.from({ length: 10 }, (_, index) => ({ from: index / 10, to: (index + 1) / 10,
    count: sorted.filter((value) => value >= index / 10 && (index === 9 ? value <= 1 : value < (index + 1) / 10)).length }));
  return { n: sorted.length, min: sorted[0] ?? null, p25: at(0.25), median: at(0.5), p75: at(0.75), max: sorted.at(-1) ?? null, bins };
}
