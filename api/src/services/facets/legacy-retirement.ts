/**
 * Legacy signal/graph retirement fence: explicit closed/retired answers.
 * Serving is the default (zero behavior change); cutover-closed answers 503
 * and retired answers 410, both naming the scoped successor. A 404 is never
 * a valid retirement answer: the MCP `search_signals` consumer maps 404 to
 * an empty list.
 */

export type LegacyRetirementState = "serving" | "cutover-closed" | "retired";

export const LEGACY_CUTOVER_CLOSED = "legacy_cutover_closed" as const;
export const LEGACY_RETIRED = "legacy_retired" as const;

export function legacyFenceStatus(
  state: LegacyRetirementState | undefined,
): 503 | 410 | null {
  if (state === "cutover-closed") return 503;
  if (state === "retired") return 410;
  return null;
}

export function legacyFenceError(
  status: 503 | 410,
): typeof LEGACY_CUTOVER_CLOSED | typeof LEGACY_RETIRED {
  return status === 503 ? LEGACY_CUTOVER_CLOSED : LEGACY_RETIRED;
}
