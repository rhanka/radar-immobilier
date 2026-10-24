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
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  accountUsers,
  facetActivationState,
  facetEventBindings,
  facetEvents,
  facetHeads,
  facetStreamAttachments,
  facetStreams,
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

/** Declared persisted shape; a qualified empty history declares zero explicitly. */
export interface ExpectedActivationPersistence {
  streams: number;
  bindings: number;
  heads: number;
}

/** Bounded operator evidence: counts only, no event payloads. */
export interface ActivationPersistenceEvidence {
  streams: number;
  bindings: number;
  heads: number;
}

/**
 * Verify real bindings, terminal heads and scoped projections while the 6H
 * barrier stays closed. Throws closed on any missing, mismatched or
 * incorrectly scoped state. Reading a store without using its result never
 * qualifies: every count below is compared against the declared expectation,
 * so an empty iteration passes only for an explicitly declared empty history.
 * `scopedEpochFor` and public readers stay closed by design.
 */
export async function verifyPersonalActivationPersistence(
  db: Database,
  workspaceId: string,
  actorSub: string,
  expected: ExpectedActivationPersistence,
): Promise<ActivationPersistenceEvidence> {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await managingActorId(tx, workspaceId, actorSub);
    const [state] = await tx.select().from(facetActivationState)
      .where(eq(facetActivationState.workspaceId, workspaceId));
    if (!state) throw new ScopeError(503, "activation_not_scoped");
    if (state.writerEpoch !== SCOPED_EPOCH) throw new ScopeError(409, "activation_not_scoped");
    if (state.maintenanceBarrier !== true) throw new ScopeError(409, "activation_already_open");
    const streams = await tx.select().from(facetStreams).where(
      eq(facetStreams.workspaceId, workspaceId));
    if (streams.some((stream) => stream.scope !== "personal")) {
      throw new ScopeError(503, "activation_scope_mismatch");
    }
    const streamIds = new Set(streams.map((stream) => stream.id));
    const bindings = streamIds.size === 0 ? [] : await tx.select().from(facetEventBindings);
    const scopedBindings = bindings.filter((binding) => streamIds.has(binding.streamId));
    const heads = streamIds.size === 0 ? [] : await tx.select().from(facetHeads);
    const scopedHeads = heads.filter((head) => streamIds.has(head.streamId));
    const attached = await tx.select().from(facetStreamAttachments).where(and(
      eq(facetStreamAttachments.workspaceId, workspaceId),
      eq(facetStreamAttachments.status, "attached")));
    for (const attachment of attached) {
      const [misbound] = await tx.select({ id: facetEvents.id }).from(facetEvents)
        .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
        .leftJoin(facetStreams, eq(facetStreams.id, facetEventBindings.streamId))
        .where(and(eq(facetEvents.ownerId, attachment.accountId),
          eq(facetEvents.scope, "personal"), or(isNull(facetEventBindings.eventId),
            isNull(facetStreams.id), ne(facetStreams.workspaceId, workspaceId)))).limit(1);
      if (misbound) throw new ScopeError(503, "personal_history_unresolved");
    }
    const bindingByEvent = new Map(scopedBindings.map((binding) => [binding.eventId, binding.streamId]));
    const streamById = new Map(streams.map((stream) => [stream.id, stream]));
    const scopedEventIds = [...new Set(scopedBindings.map((binding) => binding.eventId))];
    const scopedEvents = scopedEventIds.length === 0 ? [] : await tx.select().from(facetEvents)
      .where(inArray(facetEvents.id, scopedEventIds));
    const eventById = new Map(scopedEvents.map((event) => [event.id, event]));
    for (const binding of scopedBindings) {
      const stream = streamById.get(binding.streamId);
      const event = eventById.get(binding.eventId);
      if (!stream || !event) throw new ScopeError(503, "personal_history_unresolved");
      if (event.scope !== "personal" || event.ownerId !== stream.ownerId
        || event.citySlug !== stream.citySlug || event.nodeType !== stream.nodeType
        || event.nodeId !== stream.nodeId || event.facet !== stream.facet
        || (event.basket ?? null) !== (stream.basket ?? null)) {
        throw new ScopeError(503, "activation_identity_mismatch");
      }
      for (const link of [event.supersedes, event.supersededBy] as const) {
        if (link !== null && bindingByEvent.has(link)
          && bindingByEvent.get(link) !== binding.streamId) {
          throw new ScopeError(503, "activation_identity_mismatch");
        }
      }
    }
    for (const head of scopedHeads) {
      if (bindingByEvent.get(head.eventId) !== head.streamId) {
        throw new ScopeError(503, "activation_head_mismatch");
      }
    }
    const projection = await tx.select({ event: facetEvents }).from(facetStreams)
      .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
      .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
      .where(and(eq(facetStreams.workspaceId, workspaceId),
        eq(facetStreams.scope, "personal")));
    if (projection.some(({ event }) => event.supersededBy !== null)) {
      throw new ScopeError(503, "activation_head_mismatch");
    }
    if (streams.length !== expected.streams || scopedBindings.length !== expected.bindings
      || projection.length !== expected.heads || scopedHeads.length !== expected.heads) {
      throw new ScopeError(503, "activation_projection_mismatch");
    }
    return { streams: streams.length, bindings: scopedBindings.length, heads: projection.length };
  });
}
