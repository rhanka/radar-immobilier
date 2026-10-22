/**
 * 6L1 durable revisions: scoped facet counters, city source revisions,
 * authorized scope reads, and bounded coherent refetch.
 *
 * Guards stay the reference: approval, workspace membership with
 * capabilities, explicit workspace and city, and the scoped epoch. An
 * unauthorized viewer learns nothing: every failure precedes any revision
 * disclosure. Another member's personal rows are never read here.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  facetEventBindings,
  facetEvents,
  graphNodes,
  graphSourceRevisions,
  personalProjectionRevisions,
  workspaceMemberships,
  workspaceProjectionRevisions,
} from "../../db/schema.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { scopedEpochFor } from "./activation.js";
import { requireScopedEpoch, ScopeError } from "./scope.js";
import {
  SIGNAL_PROJECTION_MODE,
  sourceContentDigest,
  projectionToken,
  type ProjectionScope,
} from "./projection-scope.js";

type RevisionTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Bump the viewer's personal counter for one city; returns the new value. */
export async function bumpPersonalRevision(
  tx: RevisionTx, workspaceId: string, ownerId: string, citySlug: string,
): Promise<number> {
  const [row] = await tx.insert(personalProjectionRevisions).values({
    workspaceId, ownerId, citySlug, mode: SIGNAL_PROJECTION_MODE, revision: 1,
  }).onConflictDoUpdate({
    target: [personalProjectionRevisions.workspaceId, personalProjectionRevisions.ownerId,
      personalProjectionRevisions.citySlug, personalProjectionRevisions.mode],
    set: { revision: sql`${personalProjectionRevisions.revision} + 1`, updatedAt: new Date() },
  }).returning({ revision: personalProjectionRevisions.revision });
  return row!.revision;
}

/** Bump the shared workspace counter for one city; returns the new value. */
export async function bumpWorkspaceRevision(
  tx: RevisionTx, workspaceId: string, citySlug: string,
): Promise<number> {
  const [row] = await tx.insert(workspaceProjectionRevisions).values({
    workspaceId, citySlug, mode: SIGNAL_PROJECTION_MODE, revision: 1,
  }).onConflictDoUpdate({
    target: [workspaceProjectionRevisions.workspaceId,
      workspaceProjectionRevisions.citySlug, workspaceProjectionRevisions.mode],
    set: { revision: sql`${workspaceProjectionRevisions.revision} + 1`, updatedAt: new Date() },
  }).returning({ revision: workspaceProjectionRevisions.revision });
  return row!.revision;
}

export interface GraphSourceBump {
  revision: number;
  digest: string;
}

/**
 * Record the city's served signal content. The revision increments only
 * when that content changes: an identical refresh, a community-only
 * refresh, or a backdated identical import bumps nothing.
 */
export async function bumpGraphSourceRevision(
  tx: RevisionTx, citySlug: string,
): Promise<GraphSourceBump> {
  const rows = await tx.select({ id: graphNodes.id, type: graphNodes.type, label: graphNodes.label,
    sourceRef: graphNodes.sourceRef, props: graphNodes.props })
    .from(graphNodes).where(eq(graphNodes.citySlug, citySlug));
  const signals = rows.filter((row) => row.type === "Signal" || row.type === "DesignationEvent");
  const contentDigest = sourceContentDigest(signals);
  const [current] = await tx.select().from(graphSourceRevisions)
    .where(eq(graphSourceRevisions.citySlug, citySlug));
  if (current && current.contentDigest === contentDigest) {
    return { revision: current.revision, digest: contentDigest };
  }
  if (!current) {
    await tx.insert(graphSourceRevisions).values({ citySlug, revision: 0, contentDigest });
    return { revision: 0, digest: contentDigest };
  }
  const [updated] = await tx.update(graphSourceRevisions)
    .set({ revision: current.revision + 1, contentDigest, updatedAt: new Date() })
    .where(eq(graphSourceRevisions.citySlug, citySlug))
    .returning({ revision: graphSourceRevisions.revision });
  return { revision: updated!.revision, digest: contentDigest };
}

