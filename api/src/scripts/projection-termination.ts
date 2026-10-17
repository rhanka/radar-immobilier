/**
 * GH #817 — termination summary of a projection with declared changes, written to
 * /dev/termination-log (the only report readable with the preprod credential). It
 * stays valid JSON within TERMINATION_MAX_BYTES UTF-8 bytes by shrinking the lists:
 * property keys come from the database and may be multi-byte (review ASTRA-853-R2-01).
 */
import type { DeclaredChangesReport } from "../services/graph/graph-store.js";

export const TERMINATION_MAX_BYTES = 4000;

export function declaredTerminationSummary(
  report: Record<string, unknown>,
  preview: boolean,
  declared: DeclaredChangesReport | undefined,
): string {
  for (const cap of [64, 24, 8, 0]) {
    const list = (xs: readonly string[]) => (xs.length > cap ? [...xs.slice(0, cap), `…+${xs.length - cap}`] : xs);
    const body = JSON.stringify({
      ...report,
      preview,
      declared: declared
        ? {
            plannedRemovals: list(declared.plannedRemovals),
            plannedLosses: list(declared.plannedLosses),
            declaredNotInPlan: list(declared.declaredNotInPlan),
            undeclaredRemovals: list(declared.undeclaredRemovals),
          }
        : null,
    });
    if (Buffer.byteLength(body, "utf8") <= TERMINATION_MAX_BYTES) return body;
  }
  // Counts only (the report fields are numbers and the one validated ASCII city slug).
  return JSON.stringify({ ...report, abortedCities: undefined, preview, declared: "truncated" });
}
