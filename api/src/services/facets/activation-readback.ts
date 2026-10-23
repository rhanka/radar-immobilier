/**
 * 6H internal personal activation readback authorization.
 *
 * Internal only: never mounted on a route and takes no public bypass input.
 * Reads real PostgreSQL state while the 6H maintenance barrier stays closed,
 * rechecks management authority, account approval, active memberships,
 * qualified attachments and the scoped epoch, and returns bounded operator
 * evidence without private contents. Calling a reader without using its
 * result never qualifies; this function throws on any missing or mismatched
 * state. `scopedEpochFor` and public readers stay closed by design: this
 * check reads `facet_activation_state` directly so the barrier-closed epoch
 * remains verifiable internally while public reads still report 503.
 * 6H opens by clearing its barrier after readback; 6K keeps its legacy
 * fence and opens `destinationOpen` separately.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  accountUsers,
  facetActivationState,
  facetStreamAttachments,
  workspaceMemberships,
} from "../../db/schema.js";
import { lockWorkspace, managingActorId } from "../workspaces/mutations.js";
import { SCOPED_EPOCH, ScopeError } from "./scope.js";

/** Bounded operator evidence: counts only, no event payloads. */
export interface PersonalReadbackEvidence {
  workspaceId: string;
  epoch: typeof SCOPED_EPOCH;
  barrierClosed: true;
  attachedAccounts: number;
  activeMemberships: number;
}

/**
 * Authorize internal readback for one workspace and actor under the closed
 * barrier. Throws closed on any missing, mismatched or incorrectly scoped
 * persisted state. Pure authorization; binding, head and projection values
 * are verified by the next slice before opening.
 */
export async function authorizePersonalActivationReadback(
  db: Database,
  workspaceId: string,
  actorSub: string,
): Promise<PersonalReadbackEvidence> {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await managingActorId(tx, workspaceId, actorSub);
    const [state] = await tx.select().from(facetActivationState)
      .where(eq(facetActivationState.workspaceId, workspaceId));
    if (!state) throw new ScopeError(503, "activation_not_scoped");
    if (state.writerEpoch !== SCOPED_EPOCH) throw new ScopeError(409, "activation_not_scoped");
    if (state.maintenanceBarrier !== true) throw new ScopeError(409, "activation_already_open");
    const attachments = await tx.select().from(facetStreamAttachments).where(and(
      eq(facetStreamAttachments.workspaceId, workspaceId),
      eq(facetStreamAttachments.status, "attached")));
    if (attachments.length === 0) throw new ScopeError(409, "activation_without_attachment");
    const ambiguous = await tx.select().from(facetStreamAttachments).where(and(
      eq(facetStreamAttachments.status, "pending-ambiguous"),
      sql`${facetStreamAttachments.detail}->'ids' ? ${workspaceId.toLowerCase()}`));
    if (ambiguous.length > 0) throw new ScopeError(503, "personal_history_unresolved");
    let activeMemberships = 0;
    for (const attachment of attachments) {
      const [approved] = await tx.select({ id: accountUsers.id }).from(accountUsers).where(and(
        eq(accountUsers.id, attachment.accountId), eq(accountUsers.status, "approved"))).for("share");
      if (!approved) throw new ScopeError(403, "account_not_approved");
      const [membership] = await tx.select().from(workspaceMemberships).where(and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.accountId, attachment.accountId))).for("share");
      if (membership?.status !== "active") throw new ScopeError(403, "workspace_membership_required");
      activeMemberships += 1;
    }
    return {
      workspaceId,
      epoch: SCOPED_EPOCH,
      barrierClosed: true as const,
      attachedAccounts: attachments.length,
      activeMemberships,
    };
  });
}
