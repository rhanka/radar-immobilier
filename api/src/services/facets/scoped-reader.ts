/**
 * 6H scoped personal reader: viewer-only projection in one workspace.
 *
 * Personal heads only, for the calling viewer, in the selected workspace.
 * Another member's personal state never appears in reads, conflicts, or
 * receipts, and personal state is never surfaced as workspace state (no
 * personal-to-workspace conversion). Before activation the scope stays
 * unavailable (503); legacy readers keep serving unchanged behavior.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  facetEvents,
  facetHeads,
  facetStreams,
  facetEventBindings,
  graphNodes,
} from "../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { targetFingerprint, type SignalTarget } from "./target.js";
import { facetEventResponse } from "./response.js";
import { requireScopedEpoch, ScopeError, streamKey, type StreamIdentity } from "./scope.js";
import { scopedEpochFor } from "./activation.js";
import type { Basket } from "./writer.js";

type ScopedTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface StreamRef {
  id: string;
  headEventId: string | null;
}

/** Resolve the stream for one facet target under its advisory lock. */
export async function resolveStream(
  tx: ScopedTx, workspaceId: string, accountId: string, target: SignalTarget,
  facet: string, basket: Basket | null,
): Promise<StreamRef> {
  const identityKey = streamKey(streamIdentityFor(workspaceId, accountId, {
    citySlug: target.citySlug, nodeType: target.type,
    nodeId: target.id, facet: facet as "selection" | "archive",
    basket,
  }));
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identityKey}, 0))`);
  const [stream] = await tx.select().from(facetStreams).where(and(
    eq(facetStreams.workspaceId, workspaceId), eq(facetStreams.scope, "personal"),
    eq(facetStreams.ownerId, accountId), eq(facetStreams.citySlug, target.citySlug),
    eq(facetStreams.nodeType, target.type), eq(facetStreams.nodeId, target.id),
    eq(facetStreams.facet, facet), basket === null
      ? isNull(facetStreams.basket) : eq(facetStreams.basket, basket)));
  if (!stream) return { id: "", headEventId: null };
  const [head] = await tx.select().from(facetHeads)
    .where(eq(facetHeads.streamId, stream.id));
  return { id: stream.id, headEventId: head?.eventId ?? null };
}

export interface ScopedHead {
  id: string;
  target: { citySlug: string; type: string; id: string };
  facet: string;
  basket: string | null;
  state: string;
  reasonCode: string | null;
  verdict: string | null;
  createdAt: string;
  targetAvailable: boolean;
  changedSinceArchive: boolean | null;
}

export async function readScopedPersonalHeads(
  db: Database, sub: string, workspaceId: string, city: string,
): Promise<ScopedHead[]> {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    return readAuthorizedHeads(tx, sub, workspaceId, city);
  });
}

async function readAuthorizedHeads(
  db: Pick<Database, "select">, sub: string, workspaceId: string, city: string,
): Promise<ScopedHead[]> {
  const accountId = await approvedAccountId(db, sub, true);
  await resolveWorkspaceAccess(db, workspaceId, sub);
  requireScopedEpoch(await scopedEpochFor(db, workspaceId), workspaceId);
  const [unresolved] = await db.select({ id: facetEvents.id }).from(facetEvents)
    .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
    .where(and(eq(facetEvents.ownerId, accountId), isNull(facetEventBindings.eventId))).limit(1);
  if (unresolved) throw new ScopeError(503, "personal_history_unresolved");
  const rows = await db.select({ event: facetEvents, node: graphNodes })
    .from(facetStreams)
    .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
    .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
    .leftJoin(graphNodes, and(eq(graphNodes.citySlug, facetEvents.citySlug),
      eq(graphNodes.type, facetEvents.nodeType), eq(graphNodes.id, facetEvents.nodeId)))
    .where(and(eq(facetStreams.workspaceId, workspaceId),
      eq(facetStreams.scope, "personal"), eq(facetStreams.ownerId, accountId),
      eq(facetStreams.citySlug, city)))
    .orderBy(facetEvents.nodeType, facetEvents.nodeId, facetEvents.facet, facetEvents.basket);
  return rows.map(({ event, node }) => ({
    ...facetEventResponse(event),
    targetAvailable: node !== null,
    changedSinceArchive: event.facet === "archive" && event.state === "active" && node !== null
      ? event.observedFingerprint !== targetFingerprint(node) : null,
  }));
}

export function streamIdentityFor(
  workspaceId: string, ownerId: string, event: Pick<StreamIdentity,
    "citySlug" | "nodeType" | "nodeId" | "facet" | "basket">,
): StreamIdentity {
  return {
    workspaceId, scope: "personal", ownerId, targetType: "signal",
    citySlug: event.citySlug, nodeType: event.nodeType, nodeId: event.nodeId,
    facet: event.facet, basket: event.basket,
  };
}
