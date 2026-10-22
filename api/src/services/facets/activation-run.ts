/**
 * 6H protected activation runner: bind qualified personal chains, then
 * replace the workspace-blind head index and switch the writer epoch in
 * one transaction. Before commit, failure retains the old index and epoch;
 * after commit, recovery uses the new authority while the maintenance
 * barrier stays closed until readback succeeds.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  accountUsers,
  facetActivationState,
  facetCommandContexts,
  facetEvents,
  facetStreamAttachments,
  workspaceMemberships,
} from "../../db/schema.js";
import { lockWorkspace, managingActorId } from "../workspaces/mutations.js";
import { SCOPED_EPOCH, ScopeError } from "./scope.js";
import { bindAttachedChains } from "./activation-bind.js";
import { resumePersonalAttachmentReadback } from "./activation-open.js";
import {
  attachedAccounts,
  type ActivationInput,
  type ActivationReceipt,
  type ActivationSafety,
} from "./activation.js";

export async function runPersonalAttachmentActivation(
  db: Database, input: ActivationInput, safety?: ActivationSafety,
): Promise<ActivationReceipt> {
  if (!safety) throw new ScopeError(503, "activation_delivery_safety_required");
  if (input.reason.length === 0 || input.reason.length > 512) {
    throw new ScopeError(400, "invalid_activation_command");
  }
  const barrierAt = await db.transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    await managingActorId(tx, input.workspaceId, input.actorSub);
    const [existing] = await tx.select().from(facetActivationState)
      .where(eq(facetActivationState.workspaceId, input.workspaceId));
    if (existing?.writerEpoch === SCOPED_EPOCH) throw new ScopeError(409, "activation_already_scoped");
    const stamp = new Date();
    if (existing) {
      await tx.update(facetActivationState).set({ maintenanceBarrier: true, updatedAt: stamp })
        .where(eq(facetActivationState.workspaceId, input.workspaceId));
    } else {
      await tx.insert(facetActivationState).values({
        workspaceId: input.workspaceId, writerEpoch: "legacy",
        maintenanceBarrier: true, oldIndexDropped: false, updatedAt: stamp,
      });
    }
    return stamp;
  });
  await safety.drain(input.workspaceId);
  const receipt = await db.transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    await managingActorId(tx, input.workspaceId, input.actorSub);
    const [epoch] = await tx.select().from(facetActivationState)
      .where(eq(facetActivationState.workspaceId, input.workspaceId));
    if (epoch?.writerEpoch !== "legacy" || !epoch.maintenanceBarrier) {
      throw new ScopeError(409, "activation_already_scoped");
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
      ["facet-activation", input.workspaceId.toLowerCase()])}, 0))`);
    await tx.execute(sql`LOCK TABLE facet_events, facet_commands, facet_streams,
      facet_event_bindings, facet_heads IN ACCESS EXCLUSIVE MODE`);
    const attachments = await attachedAccounts(tx, input.workspaceId);
    if (attachments.length === 0) throw new ScopeError(409, "activation_without_attachment");
    for (const attachment of attachments) {
      const [approved] = await tx.select({ id: accountUsers.id }).from(accountUsers).where(and(
        eq(accountUsers.id, attachment.accountId), eq(accountUsers.status, "approved"),
      )).for("share");
      if (!approved) throw new ScopeError(403, "account_not_approved");
      const [membership] = await tx.select().from(workspaceMemberships).where(and(
        eq(workspaceMemberships.workspaceId, input.workspaceId),
        eq(workspaceMemberships.accountId, attachment.accountId),
      )).for("share");
      if (membership?.status !== "active") throw new ScopeError(403, "workspace_membership_required");
      const [late] = await tx.select({ id: facetEvents.id }).from(facetEvents).where(and(
        eq(facetEvents.ownerId, attachment.accountId), gt(facetEvents.createdAt, barrierAt))).limit(1);
      if (late) throw new ScopeError(409, "activation_traffic_not_drained");
    }
    const { streamsBound, sealedUnresolved } = await bindAttachedChains(tx, input.workspaceId, attachments);
    const indexRows = await tx.execute(sql`SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = 'facet_events_head_idx'`);
    const switched = await tx.select().from(facetActivationState)
      .where(eq(facetActivationState.oldIndexDropped, true));
    if (indexRows.rows.length === 0 && switched.length === 0) {
      throw new ScopeError(409, "activation_head_index_missing");
    }
    await tx.execute(sql`SELECT facet_swap_head_enforcement(${input.workspaceId})`);
    return { streamsBound, sealedUnresolved };
  });
  const pendingCount = await db.select().from(facetCommandContexts).where(and(
    eq(facetCommandContexts.workspaceId, input.workspaceId),
    eq(facetCommandContexts.status, "pending")));
  const ambiguous = await db.select().from(facetStreamAttachments)
    .where(eq(facetStreamAttachments.status, "pending-ambiguous"));
  if (receipt.sealedUnresolved.length === 0 && !ambiguous.some((row) =>
    (row.detail as { ids: string[] }).ids.includes(input.workspaceId))) {
    await resumePersonalAttachmentReadback(db, input, safety);
  }
  return {
    workspaceId: input.workspaceId,
    streamsBound: receipt.streamsBound,
    headsRegistered: receipt.streamsBound,
    sealedUnresolved: receipt.sealedUnresolved,
    pendingReceipts: pendingCount.length,
    epoch: SCOPED_EPOCH,
  };
}
