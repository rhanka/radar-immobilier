/**
 * 6J destination gate.
 *
 * Lot business writes and scoped lot reads stay unavailable until 6K
 * enables the workspace destination with its configured historical
 * favorites basket. Missing, disabled, or basket-less destinations fail
 * closed; no grant or default ever substitutes the explicit gate.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { lotDestinationState } from "../../../db/schema.js";
import { ScopeError } from "../scope.js";

export interface LotDestination {
  workspaceId: string;
  enabled: true;
  selectionBasket: string;
}

export async function requireLotDestination(
  db: Pick<Database, "select">, workspaceId: string,
): Promise<LotDestination> {
  const [row] = await db.select().from(lotDestinationState)
    .where(eq(lotDestinationState.workspaceId, workspaceId));
  if (!row || row.enabled !== true
    || typeof row.selectionBasket !== "string" || row.selectionBasket === "") {
    throw new ScopeError(503, `lot_destination_disabled:${workspaceId}`);
  }
  return { workspaceId, enabled: true, selectionBasket: row.selectionBasket };
}
