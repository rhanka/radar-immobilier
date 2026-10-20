export const FACET_PROFILE = "immo-steve-2026-09";
export interface ClassifiedCode { code: string; verdict: string }

/** Exact pair equality, independent of order; duplicates are fidelity errors. */
export function compareCodebook(
  expected: readonly ClassifiedCode[], actual: readonly ClassifiedCode[],
) {
  const key = (row: ClassifiedCode) => JSON.stringify([row.code, row.verdict]);
  const left = new Set(expected.map(key));
  const right = new Set(actual.map(key));
  const missing = [...left].filter((entry) => !right.has(entry)).sort();
  const unexpected = [...right].filter((entry) => !left.has(entry)).sort();
  const duplicates = [expected, actual].map((rows) => rows.length - new Set(rows.map(key)).size);
  return {
    equal: missing.length === 0 && unexpected.length === 0 && duplicates.every((n) => n === 0),
    missing, unexpected, duplicates,
  };
}
