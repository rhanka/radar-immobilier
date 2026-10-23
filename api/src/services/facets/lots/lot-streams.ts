/**
 * 6J lot stream identity, advisory locking, and head lookup.
 *
 * One stream per (workspace, scope, owner, mode, target, facet, basket):
 * selection uses the configured workspace basket, archive/pipeline/market
 * use a null basket. Simulation and real state are never merged.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  facetEvents,
  facetHeads,
  facetStreams,
} from "../../../db/schema.js";
import type { LotMode, LotTarget } from "./lot-target.js";
import { lotSourceLockKey } from "./lot-source-serialization.js";

export type LotFacet = "selection" | "archive" | "pipeline" | "market";
export type LotStreamScope = "personal" | "workspace";

export interface LotStreamRef {
  id: string;
  headEventId: string | null;
}

/**
 * Canonical-target serialization held through source comparison and
 * commit. Delegates to the shared 6K serialization key so source writers
 * and facet writers serialize on the same lock.
 */
export async function lotTargetLock(
  tx: { execute: Database["execute"] },
  target: Pick<LotTarget, "citySlug" | "canonicalId">,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${
    lotSourceLockKey(target.citySlug, target.canonicalId)}, 0))`);
}

export function lotStreamKey(
  workspaceId: string, scope: LotStreamScope, ownerId: string | null,
  mode: LotMode, target: LotTarget, facet: LotFacet, basket: string | null,
): string {
  return JSON.stringify(["facet-stream", workspaceId.toLowerCase(), scope, ownerId ?? "",
    "lot", mode, target.citySlug, "Lot", target.canonicalId, facet, basket]);
}

type StreamTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function resolveLotStream(
  tx: StreamTx, workspaceId: string, scope: LotStreamScope, ownerId: string | null,
  mode: LotMode, target: LotTarget, facet: LotFacet, basket: string | null,
): Promise<LotStreamRef> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${
    lotStreamKey(workspaceId, scope, ownerId, mode, target, facet, basket)}, 0))`);
  const ownerCondition = ownerId === null
    ? isNull(facetStreams.ownerId)
    : eq(facetStreams.ownerId, ownerId);
  const [stream] = await tx.select().from(facetStreams).where(and(
    eq(facetStreams.workspaceId, workspaceId),
    eq(facetStreams.scope, scope),
    ownerCondition,
    eq(facetStreams.targetType, "lot"),
    eq(facetStreams.mode, mode),
    eq(facetStreams.citySlug, target.citySlug),
    eq(facetStreams.nodeType, "Lot"),
    eq(facetStreams.nodeId, target.canonicalId),
    eq(facetStreams.facet, facet),
    basket === null ? isNull(facetStreams.basket) : eq(facetStreams.basket, basket),
  ));
  if (!stream) return { id: "", headEventId: null };
  const [head] = await tx.select().from(facetHeads).where(eq(facetHeads.streamId, stream.id));
  return { id: stream.id, headEventId: head?.eventId ?? null };
}

export interface LotStreamHead {
  event: typeof facetEvents.$inferSelect;
}

/** Head event of one lot stream; null when the stream has no head. */
export async function lotStreamHead(
  db: Pick<Database, "select">, streamId: string,
): Promise<LotStreamHead | null> {
  const [row] = await db.select({ event: facetEvents })
    .from(facetHeads)
    .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
    .where(eq(facetHeads.streamId, streamId))
    .limit(1);
  return row ?? null;
}
