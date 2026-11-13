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

/** Viewer-only selections and effective archives, under the same scoped guards. */
async function readScopedSignalClassement(
  db: Database, sub: string, workspaceId: string,
) {
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
        eq(facetStreams.targetType, "signal"),
        or(and(eq(facetStreams.facet, "archive"), isNull(facetStreams.basket)),
          and(eq(facetStreams.scope, "personal"), eq(facetStreams.facet, "selection")))));
    const hidden = new Set<DiscardedSignalKey>();
    const classement = new Map<DiscardedSignalKey, keyof import("@radar/domain").VivierFiltreCubesByClassement>();
    for (const { event } of rows) {
      if (event.state !== "active") continue;
      const key = discardedSignalKey(event.citySlug, event.nodeType, event.nodeId);
      if (event.facet === "archive") hidden.add(key);
      // Same precedence as the detail: archive > pertinent > a_surveiller.
      else if (event.basket === "pertinent" || (event.basket === "a_surveiller" && !classement.has(key))) {
        classement.set(key, event.basket);
      }
    }
    for (const key of hidden) classement.set(key, "ecarte");
    return { hidden, classement };
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
  const { hidden, classement } = await readScopedSignalClassement(db, sub, workspaceId);
  const cities = await listCitiesWithSignalNodes(db, query.dateRange, {
    ...(!query.showDiscarded ? { discarded: hidden } : {}), classement,
  });
  return { totalCount: cities.reduce((sum, city) => sum + city.signalCount, 0), cities };
}
