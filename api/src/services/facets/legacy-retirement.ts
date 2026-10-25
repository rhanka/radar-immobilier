/**
 * Legacy signal/graph retirement fence: explicit closed/retired answers.
 * Serving is the default (zero behavior change); cutover-closed answers 503
 * and retired answers 410, both naming the scoped successor. A 404 is never
 * a valid retirement answer: the MCP `search_signals` consumer maps 404 to
 * an empty list.
 */

import type { Database } from "../../db/client.js";
import { facetActivationState } from "../../db/schema.js";
import { LEGACY_EPOCH, SCOPED_EPOCH, ScopeError } from "./scope.js";

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

/**
 * Durable retirement for guarded restart (server internal only).
 *
 * Zero rows, or all-legacy rows with an open barrier and an intact index,
 * prove that no cutover happened and resolve to undefined (the serving
 * default stays in app.ts). Any closed barrier resolves to cutover-closed;
 * a proven scoped epoch or a dropped head index resolves to retired.
 * Unknown epochs, incoherent flags, or read failures reject, so the
 * index.ts caller starts closed instead of serving.
 */
export async function readDurableLegacyRetirement(
  db: Database,
): Promise<LegacyRetirementState | undefined> {
  const rows = await db.select().from(facetActivationState);
  if (rows.length === 0) return undefined;
  for (const row of rows) {
    if ((row.writerEpoch !== LEGACY_EPOCH && row.writerEpoch !== SCOPED_EPOCH)
      || typeof row.maintenanceBarrier !== "boolean"
      || typeof row.oldIndexDropped !== "boolean"
      || (row.writerEpoch === LEGACY_EPOCH && row.oldIndexDropped)) {
      throw new ScopeError(503, "durable_retirement_ambiguous");
    }
  }
  if (rows.some((row) => row.maintenanceBarrier)) return "cutover-closed";
  if (rows.some((row) => row.oldIndexDropped || row.writerEpoch === SCOPED_EPOCH)) return "retired";
  return undefined;
}
