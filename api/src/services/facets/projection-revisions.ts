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

export interface ProjectionRead extends ProjectionScope {
  token: string;
}

/**
 * Authorized revision scope for one viewer, workspace, city, and mode.
 * Approval, membership, epoch, and history attachment are established
 * before any number is disclosed.
 */
export async function readProjectionScope(
  db: Database, sub: string, workspaceId: string, citySlug: string, mode: string,
): Promise<ProjectionRead> {
  return db.transaction((tx) => readProjectionScopeInTx(tx, sub, workspaceId, citySlug, mode));
}

/** Authorized scope in the caller's snapshot, without a nested transaction. */
export async function readProjectionScopeInTx(
  tx: RevisionTx, sub: string, workspaceId: string, citySlug: string, mode: string,
): Promise<ProjectionRead> {
  if (mode !== SIGNAL_PROJECTION_MODE) throw new ScopeError(400, "unsupported_projection_mode");
  if (typeof citySlug !== "string" || citySlug.length === 0) {
    throw new ScopeError(400, "invalid_scoped_identity");
  }
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const [unresolved] = await tx.select({ id: facetEvents.id }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(and(eq(facetEvents.ownerId, accountId),
        isNull(facetEventBindings.eventId))).limit(1);
    if (unresolved) throw new ScopeError(503, "personal_history_unresolved");
    const [membership] = await tx.select().from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, workspaceId),
      eq(workspaceMemberships.accountId, accountId)));
    if (!membership || membership.status !== "active") {
      throw new ScopeError(403, "workspace_membership_required");
    }
    const [personal] = await tx.select().from(personalProjectionRevisions).where(and(
      eq(personalProjectionRevisions.workspaceId, workspaceId),
      eq(personalProjectionRevisions.ownerId, accountId),
      eq(personalProjectionRevisions.citySlug, citySlug),
      eq(personalProjectionRevisions.mode, SIGNAL_PROJECTION_MODE)));
    const [shared] = await tx.select().from(workspaceProjectionRevisions).where(and(
      eq(workspaceProjectionRevisions.workspaceId, workspaceId),
      eq(workspaceProjectionRevisions.citySlug, citySlug),
      eq(workspaceProjectionRevisions.mode, SIGNAL_PROJECTION_MODE)));
    const [source] = await tx.select().from(graphSourceRevisions)
      .where(eq(graphSourceRevisions.citySlug, citySlug));
    const scope: ProjectionScope = {
      workspaceId, accountId, citySlug, mode: SIGNAL_PROJECTION_MODE,
      personalRevision: personal?.revision ?? 0,
      workspaceRevision: shared?.revision ?? 0,
      sourceRevision: source?.revision ?? 0,
      sourceDigest: source?.contentDigest ?? "",
      membershipRevision: membership.revision,
      moderateArchive: membership.moderateArchive,
      manageMembers: membership.manageMembers,
    };
    return { ...scope, token: projectionToken(scope) };
}

export interface CoherentProjection<T> {
  scope: ProjectionRead;
  payload: T;
}

/**
 * Coherent refetch: sample the revision, fetch the payload, sample again.
 * The result is acknowledged only when both samples agree; bounded retries
 * on drift, otherwise the caller keeps its stale snapshot (503).
 */
export async function readCoherentProjection<T>(
  db: Database, sub: string, workspaceId: string, citySlug: string, mode: string,
  readPayload: () => Promise<T>, maxAttempts = 3,
): Promise<CoherentProjection<T>> {
  for (let attempt = 1; ; attempt += 1) {
    const before = await readProjectionScope(db, sub, workspaceId, citySlug, mode);
    const payload = await readPayload();
    const after = await readProjectionScope(db, sub, workspaceId, citySlug, mode);
    if (before.token === after.token) return { scope: after, payload };
    if (attempt >= maxAttempts) throw new ScopeError(503, "projection_revision_unstable");
  }
}
