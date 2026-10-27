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
import { lotCutoverState, lotDestinationState } from "../../../db/schema.js";
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

/**
 * Public opening: configured eligibility plus the durable 6K opening.
 * Missing cutover state or destinationOpen=false stays closed with the
 * same 503 so no business state, history or receipt leaks. Internal
 * cutover readback uses requireLotDestination directly and never calls
 * this guard.
 */
export async function requireOpenLotDestination(
  db: Pick<Database, "select">, workspaceId: string,
): Promise<LotDestination> {
  const destination = await requireLotDestination(db, workspaceId);
  const [state] = await db.select().from(lotCutoverState)
    .where(eq(lotCutoverState.workspaceId, workspaceId));
  if (!state || state.destinationOpen !== true) {
    throw new ScopeError(503, `lot_destination_disabled:${workspaceId}`);
  }
  return destination;
}
