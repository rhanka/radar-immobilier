import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetActivationState, facetStreamAttachments, workspaceMemberships } from "../../db/schema.js";
import { approvedTargetId, lockWorkspace, managingActorId } from "../workspaces/mutations.js";
import type { ActivationInput, ActivationSafety } from "./activation.js";
import { ScopeError } from "./scope.js";

/** Explicit recovery after cutover; never recreates the workspace-blind index. */
export async function resumePersonalAttachmentReadback(
  db: Database, input: ActivationInput, safety?: ActivationSafety,
): Promise<void> {
  if (!safety) throw new ScopeError(503, "activation_delivery_safety_required");
  const check = async (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => {
    await lockWorkspace(tx, input.workspaceId);
    // Rechecked in the final transaction before opening: a revocation
    // between readback and opening blocks the barrier release with 403.
    await managingActorId(tx, input.workspaceId, input.actorSub);
    const [state] = await tx.select().from(facetActivationState)
      .where(eq(facetActivationState.workspaceId, input.workspaceId));
    if (state?.writerEpoch !== "scoped") throw new ScopeError(409, "activation_not_scoped");
    // Reject a concurrent opening without another release or timestamp write.
    if (state.maintenanceBarrier !== true) throw new ScopeError(409, "activation_already_open");
    const attachments = await tx.select().from(facetStreamAttachments).where(and(
      eq(facetStreamAttachments.workspaceId, input.workspaceId),
      eq(facetStreamAttachments.status, "attached"))).for("share");
    if (attachments.length === 0) throw new ScopeError(409, "activation_without_attachment");
    for (const attachment of attachments) {
      await approvedTargetId(tx, attachment.accountId);
      const [membership] = await tx.select().from(workspaceMemberships).where(and(
        eq(workspaceMemberships.workspaceId, input.workspaceId),
        eq(workspaceMemberships.accountId, attachment.accountId))).for("share");
      if (membership?.status !== "active") throw new ScopeError(403, "workspace_membership_required");
    }
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
