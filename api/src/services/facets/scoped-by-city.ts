/**
 * Scoped by-city aggregate (6H): the per-city counters of the legacy
 * `/api/graph-signals/by-city` read, computed by the same aggregate service
 * (`listCitiesWithSignalNodes`) under the scoped guards — approved account,
 * active membership, open scoped epoch and resolved personal history.
 *
 * Visibility matches `coherent-city`: a target effectively discarded for the
 * workspace (the viewer's personal archive or the workspace archive) is not
 * counted; `showDiscarded` counts the full population. No write, no
 * migration, and another member's personal archive never changes the counts.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetEventBindings, facetEvents, facetHeads, facetStreams } from "../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import {
  listCitiesWithSignalNodes,
  type CitySignalCounts,
  type GraphSignalDateRange,
} from "../graph/graph-store.js";
import { discardedSignalKey, type DiscardedSignalKey } from "../graph/discarded-signals.js";
import { requireScopedEpochFor } from "./activation.js";
import { ScopeError } from "./scope.js";

/** Native keys of the targets effectively archived for this viewer in this workspace. */
export async function readScopedHiddenSignalKeys(
  db: Database, sub: string, workspaceId: string,
): Promise<ReadonlySet<DiscardedSignalKey>> {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    await requireScopedEpochFor(tx, workspaceId);
    const [unresolved] = await tx.select({ id: facetEvents.id }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(and(eq(facetEvents.ownerId, accountId), isNull(facetEventBindings.eventId))).limit(1);
    if (unresolved) throw new ScopeError(503, "personal_history_unresolved");
    const rows = await tx.select({ event: facetEvents }).from(facetStreams)
      .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
      .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
      .where(and(eq(facetStreams.workspaceId, workspaceId),
        or(eq(facetStreams.scope, "workspace"), and(eq(facetStreams.scope, "personal"),
          eq(facetStreams.ownerId, accountId))),
        eq(facetStreams.targetType, "signal"), eq(facetStreams.facet, "archive"),
        isNull(facetStreams.basket)));
    return new Set(rows.filter(({ event }) => event.state === "active")
      .map(({ event }) => discardedSignalKey(event.citySlug, event.nodeType, event.nodeId)));
  });
}

export interface ScopedByCityQuery {
  dateRange?: GraphSignalDateRange;
  showDiscarded: boolean;
}

export interface ScopedByCityResult {
  totalCount: number;
  cities: CitySignalCounts[];
}

export async function readScopedByCity(
  db: Database, sub: string, workspaceId: string, query: ScopedByCityQuery,
): Promise<ScopedByCityResult> {
  // Authorization always runs, including when every target is shown.
  const hidden = await readScopedHiddenSignalKeys(db, sub, workspaceId);
  const cities = !query.showDiscarded && hidden.size > 0
    ? await listCitiesWithSignalNodes(db, query.dateRange, { discarded: hidden })
    : await listCitiesWithSignalNodes(db, query.dateRange);
  return { totalCount: cities.reduce((sum, city) => sum + city.signalCount, 0), cities };
}
