/**
 * 6I scoped union discard port: D(viewer) = D(workspace) ∪ D(personal viewer).
 *
 * Workspace archive keys and the viewer's own personal archive keys hide a
 * target; another member's personal state never contributes. Legacy readers
 * are untouched: existing graph and MCP paths keep serving their current
 * behavior until a scoped consumer adopts this port after activation.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetEventBindings, facetEvents, facetHeads, facetStreams } from "../../db/schema.js";
import {
  discardedSignalKey,
  unionDiscardedSignals,
  type DiscardedSignalKey,
  type DiscardedSignalsPort,
  type DiscardedViewer,
} from "../graph/discarded-signals.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { requireScopedEpoch, ScopeError } from "./scope.js";
import { scopedEpochFor } from "./activation.js";

/** Union keys for one viewer in one workspace; fails closed when unavailable.
 * Unattached pre-cutover personal history refuses with 503 instead of
 * returning an incomplete (possibly empty) set. */
export async function readScopedUnionDiscardedKeys(
  db: Database, sub: string, workspaceId: string,
): Promise<ReadonlySet<DiscardedSignalKey>> {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const [unresolved] = await tx.select({ id: facetEvents.id }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(and(eq(facetEvents.ownerId, accountId),
        isNull(facetEventBindings.eventId))).limit(1);
    if (unresolved) throw new ScopeError(503, "personal_history_unresolved");
    const workspace = new Set<DiscardedSignalKey>();
    const personal = new Set<DiscardedSignalKey>();
    const scoped = await tx.select({ scope: facetEvents.scope, ownerId: facetEvents.ownerId,
      citySlug: facetEvents.citySlug, nodeType: facetEvents.nodeType, nodeId: facetEvents.nodeId })
      .from(facetStreams)
      .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
      .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
      .where(and(eq(facetStreams.workspaceId, workspaceId),
        or(eq(facetStreams.scope, "workspace"), and(eq(facetStreams.scope, "personal"),
          eq(facetStreams.ownerId, accountId))),
        eq(facetStreams.facet, "archive"), isNull(facetStreams.basket),
        eq(facetEvents.state, "active")));
    for (const row of scoped) {
      const key = discardedSignalKey(row.citySlug, row.nodeType, row.nodeId);
      if (row.scope === "workspace") workspace.add(key);
      else if (row.ownerId === accountId) personal.add(key);
    }
    return unionDiscardedSignals(workspace, personal);
  });
}

/** Port factory for future scoped graph reads; anonymous viewers fail closed. */
export function createScopedUnionDiscardedSignalsReader(
  db: Database, workspaceId: string,
): DiscardedSignalsPort {
  return {
    async forViewer(viewer: DiscardedViewer) {
      if (viewer === null) throw new ScopeError(403, "workspace_membership_required");
      return readScopedUnionDiscardedKeys(db, viewer, workspaceId);
    },
  };
}
