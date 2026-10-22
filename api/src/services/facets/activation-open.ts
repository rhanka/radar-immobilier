import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetActivationState, facetStreamAttachments } from "../../db/schema.js";
import { lockWorkspace, managingActorId } from "../workspaces/mutations.js";
import type { ActivationInput, ActivationSafety } from "./activation.js";
import { ScopeError } from "./scope.js";

/** Explicit recovery after cutover; never recreates the workspace-blind index. */
export async function resumePersonalAttachmentReadback(
  db: Database, input: ActivationInput, safety?: ActivationSafety,
): Promise<void> {
  if (!safety) throw new ScopeError(503, "activation_delivery_safety_required");
  const check = async (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => {
    await lockWorkspace(tx, input.workspaceId);
    await managingActorId(tx, input.workspaceId, input.actorSub);
    const [state] = await tx.select().from(facetActivationState)
      .where(eq(facetActivationState.workspaceId, input.workspaceId));
    if (state?.writerEpoch !== "scoped") throw new ScopeError(409, "activation_not_scoped");
    const ambiguous = await tx.select().from(facetStreamAttachments).where(and(
      eq(facetStreamAttachments.status, "pending-ambiguous"),
      sql`${facetStreamAttachments.detail}->'ids' ? ${input.workspaceId.toLowerCase()}`));
    const unresolved = await tx.execute(sql`SELECT 1 FROM facet_events e
      JOIN facet_stream_attachments a ON a.account_id = e.owner_id
      LEFT JOIN facet_event_bindings b ON b.event_id = e.id
      WHERE a.workspace_id = ${input.workspaceId} AND b.event_id IS NULL LIMIT 1`);
    if (ambiguous.length > 0 || unresolved.rows.length > 0) {
      throw new ScopeError(503, "personal_history_unresolved");
    }
  };
  await db.transaction(check);
  await safety.drain(input.workspaceId);
  await safety.readback(input.workspaceId);
  await db.transaction(async (tx) => {
    await check(tx);
    await tx.update(facetActivationState).set({ maintenanceBarrier: false, updatedAt: new Date() })
      .where(eq(facetActivationState.workspaceId, input.workspaceId));
  });
}
