/**
 * 6I workspace archive streams: identity, advisory locking, and head lookup.
 *
 * One workspace archive stream holds the common archive of one signal
 * target (scope workspace, null business owner, archive facet, null
 * basket). Personal streams are owned by the viewer; this module never
 * resolves them.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  facetEvents,
  facetHeads,
  facetStreams,
  graphNodes,
} from "../../db/schema.js";
import type { SignalTarget } from "./target.js";

type StreamTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface WorkspaceStreamRef {
  id: string;
  headEventId: string | null;
}

/** Advisory-lock key for one workspace archive stream. */
export function workspaceStreamKey(workspaceId: string, target: SignalTarget): string {
  return JSON.stringify([
    "facet-stream",
    workspaceId.toLowerCase(),
    "workspace",
    "",
    "signal",
    target.citySlug,
    target.type,
    target.id,
    "archive",
    null,
  ]);
}

/** Resolve the workspace archive stream for one target under its lock. */
export async function resolveWorkspaceStream(
  tx: StreamTx, workspaceId: string, target: SignalTarget,
): Promise<WorkspaceStreamRef> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceStreamKey(workspaceId, target)}, 0))`);
  const [stream] = await tx.select().from(facetStreams).where(and(
    eq(facetStreams.workspaceId, workspaceId), eq(facetStreams.scope, "workspace"),
    isNull(facetStreams.ownerId), eq(facetStreams.citySlug, target.citySlug),
    eq(facetStreams.nodeType, target.type), eq(facetStreams.nodeId, target.id),
    eq(facetStreams.facet, "archive"), isNull(facetStreams.basket)));
  if (!stream) return { id: "", headEventId: null };
  const [head] = await tx.select().from(facetHeads)
    .where(eq(facetHeads.streamId, stream.id));
  return { id: stream.id, headEventId: head?.eventId ?? null };
}

export interface WorkspaceStreamHead {
  event: typeof facetEvents.$inferSelect;
  node: typeof graphNodes.$inferSelect | null;
}

/** Head event of one archive stream; null when the stream has no head. */
export async function workspaceStreamHead(
  db: Pick<Database, "select">, workspaceId: string, scope: "personal" | "workspace",
  ownerId: string | null, target: SignalTarget,
): Promise<WorkspaceStreamHead | null> {
  const rows = await db.select({ event: facetEvents, node: graphNodes })
    .from(facetStreams)
    .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
    .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
    .leftJoin(graphNodes, and(eq(graphNodes.citySlug, facetEvents.citySlug),
      eq(graphNodes.type, facetEvents.nodeType), eq(graphNodes.id, facetEvents.nodeId)))
    .where(and(eq(facetStreams.workspaceId, workspaceId),
      eq(facetStreams.scope, scope),
      ownerId === null ? isNull(facetStreams.ownerId) : eq(facetStreams.ownerId, ownerId),
      eq(facetStreams.citySlug, target.citySlug), eq(facetStreams.nodeType, target.type),
      eq(facetStreams.nodeId, target.id), eq(facetStreams.facet, "archive"),
      isNull(facetStreams.basket))).limit(1);
  return rows[0] ?? null;
}
