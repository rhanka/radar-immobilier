/**
 * 6K legacy fence read for the route layer.
 *
 * Returns `open` once the destination is activated (legacy mark readers
 * and writers are retired), `barrier` while a cutover barrier is
 * committed (legacy traffic is fenced), and `none` otherwise. The
 * database trigger on `prospect_marks` is the enforcing backstop,
 * including for direct writers; this read only lets routes answer with
 * the explicit 503/410 contract instead of a trigger failure. An
 * unreadable fence reports `unknown`: routes fail closed (as on
 * `barrier`), but SSE delivery only suspends mark frames for that
 * connection and never retires them irreversibly. Only an attested
 * `barrier` or `open` state retires delivery.
 */
import type { Database } from "../../../db/client.js";
import { lotCutoverState, lotLegacyFence } from "../../../db/schema.js";

export type LegacyFence = "open" | "barrier" | "none" | "unknown";

export async function legacyMarksFence(
  db: Pick<Database, "select">,
): Promise<LegacyFence> {
  try {
    const rows = await db.select().from(lotCutoverState);
    if (!Array.isArray(rows)) return "unknown";
    const list = rows;
    if (list.some((row) => row.destinationOpen === true)) return "open";
    if (list.some((row) => row.maintenanceBarrier === true)) return "barrier";
    const marker = await db.select().from(lotLegacyFence);
    if (!Array.isArray(marker) || marker.length !== 1) return "unknown";
    if (marker[0]?.enabled === true) return "barrier";
    if (marker[0]?.enabled !== false) return "unknown";
    return "none";
  } catch {
    return "unknown";
  }
}
