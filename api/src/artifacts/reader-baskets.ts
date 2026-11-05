/**
 * L3 basket bridge (ARTEFACTS A6/H5 -> paniers).
 *
 * Frozen mapping onto the existing classification services (no new basket
 * storage, same schemas, limits and errors as the workspace routes):
 * - baskets.context.v1 -> readFacetContext
 * - baskets.search.v1 -> searchSignalClassifications
 * - baskets.state.v1 -> readSignalClassification
 *
 * workspaces.list.v1 discovers active memberships using the verified reader
 * and exposes only workspace labels and signal/basket availability.
 * The caller (content-serve) supplies the verified H5 reader context. For
 * basket reads, the workspace id is explicit in the operation params: no default is
 * ever inferred. Zero membership, foreign or revoked workspaces are refused
 * inside the services (workspace_not_authorized). Several memberships
 * require the caller to pick one workspace id explicitly.
 */
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { readFacetContext } from "../services/facets/classification-context.js";
import {
  searchSignalClassifications,
  type ClassificationOptions,
} from "../services/facets/classification-search.js";
import { readSignalClassification } from "../services/facets/classification-state.js";
import { listWorkspacesForAccount } from "../services/workspaces/store.js";
import { readScopedByCity } from "../services/facets/scoped-by-city.js";
import { readCoherentProjection } from "../services/facets/projection-revisions.js";
import { readScopedPersonalHeads } from "../services/facets/scoped-reader.js";
import { readWorkspaceArchiveCity } from "../services/facets/workspace-reader.js";
import { getSignalNodesForCity } from "../services/graph/graph-store.js";
import { buildScopedSignalCards, scopedLegacyProjection } from "../services/facets/scoped-signal-cards.js";
import type { ApiReaderContext } from "./reader-context.js";
import { toByCityServiceQuery, type ByCityParams } from "./reader-by-city.js";
import { buildCoherentCityResponse, type CoherentCityParams } from "./reader-coherent-city.js";
import { isWorkspaceReadOperation, type ReaderOperationName } from "./reader-operations.js";

export interface BasketReadDeps {
  readonly db: Database;
  readonly store: ObjectStore;
  readonly classification?: ClassificationOptions | undefined;
}

export function createBasketReadOperation(deps: BasketReadDeps): (
  op: ReaderOperationName,
  params: unknown,
  context: ApiReaderContext,
) => Promise<unknown> {
  return async (op, params, context) => {
    // J1.2d/e §4.3: same service as the app route — the dispatch already
    // refused `showDiscarded` and unknown keys, so the viewer population
    // matches the app exactly. Response projection is enforced by
    // `validateReaderResponse` (strict allowlist → typed 502).
    if (op === "signals.by-city.v1") {
      const scoped = params as ByCityParams;
      const result = await readScopedByCity(deps.db, context.readerSub, scoped.workspaceId,
        toByCityServiceQuery(scoped));
      // Same envelope as the app route body (`{ ok, totalCount, cities }`).
      return { ok: true as const, totalCount: result.totalCount, cities: result.cities };
    }
    // J1.2d/e §5.5: same coherent service as the app route, assembled into
    // the closed DTO (projection + strict schema in `reader-coherent-city`).
    // Archived targets are filtered before card construction, exactly like
    // the app handler — served signals and `legacyProjection.a.signalIds`
    // never name an archived node.
    if (op === "signals.coherent-city.v1") {
      const scoped = params as CoherentCityParams;
      const coherent = await readCoherentProjection(deps.db, context.readerSub,
        scoped.workspaceId, scoped.citySlug, "signal", async () => ({
          archive: await readWorkspaceArchiveCity(deps.db, context.readerSub,
            scoped.workspaceId, scoped.citySlug),
          selection: await readScopedPersonalHeads(deps.db, context.readerSub,
            scoped.workspaceId, scoped.citySlug),
          signals: await getSignalNodesForCity(deps.db, scoped.citySlug),
        }));
      const hiddenKeys = new Set(coherent.payload.archive
        .filter((head) => head.effectiveDiscarded)
        .map((head) => JSON.stringify([head.target.type, head.target.id])));
      const visibleNodes = coherent.payload.signals.filter(
        (node) => !hiddenKeys.has(JSON.stringify([node.type, node.id])));
      const cards = await buildScopedSignalCards(
        { ...(deps.store ? { store: deps.store } : {}), docEnrichmentBudgetMs: 2000,
          // Typed journal only: never the city, the node id or the error text.
          onDegraded: () => console.error("[reader-op] signals.coherent-city.v1 card degraded") },
        visibleNodes, scoped.citySlug);
      const total = coherent.payload.signals.length;
      const selected = coherent.payload.selection
        .filter((head) => head.facet === "selection" && head.state === "active").length;
      return buildCoherentCityResponse({
        artifactId: context.artifactId, readerSub: context.readerSub,
        workspaceId: scoped.workspaceId, citySlug: scoped.citySlug,
        serverToken: coherent.scope.token, total, hidden: total - visibleNodes.length, selected,
        legacyProjection: scopedLegacyProjection(cards),
        sources: visibleNodes.map((node, index) => ({
          node: { id: node.id, type: node.type, citySlug: node.citySlug,
            label: node.label, createdAt: node.createdAt },
          card: cards[index]!,
        })),
      });
    }
    if (!isWorkspaceReadOperation(op)) throw new Error("Capability unavailable");
    if (op === "workspaces.list.v1") {
      const memberships = await listWorkspacesForAccount(deps.db, context.readerSub);
      const workspaces = [];
      for (const { workspace } of memberships) {
        // The context read stays the authorization check (revoked or foreign
        // workspaces refuse here).
        const result = await readFacetContext(deps.db, context.readerSub, workspace.id);
        if (result.workspaceId !== workspace.id) throw new Error("Workspace mismatch");
        // J1.2d/e §3.3 server-side shape adapter: the app parser shape
        // (nested `workspace`, constant read-only capabilities) ADDED next to
        // the published v1 row (`id`, `slug`, `label`, availability) that
        // starter pages already read — the op contract only widens, so no
        // published artifact breaks. Never `accountId`, never `scope`, never
        // the real capabilities.
        workspaces.push({ id: workspace.id, slug: workspace.slug, label: workspace.label,
          signals: { availability: result.signals.availability },
          workspace: { id: workspace.id, slug: workspace.slug, label: workspace.label },
          moderateArchive: false, manageMembers: false });
      }
      return { ok: true as const, workspaces };
    }
    const input = params as Record<string, unknown>;
    const workspaceId = input.workspaceId as string;
    if (op === "baskets.context.v1") {
      const contextResult = await readFacetContext(deps.db, context.readerSub, workspaceId);
      if (contextResult.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
      return { ok: true as const, context: contextResult };
    }
    if (op === "baskets.search.v1") {
      const { workspaceId: ws, ...query } = input;
      void ws;
      const result = await searchSignalClassifications(
        { db: deps.db, store: deps.store, ...(deps.classification ? { classification: deps.classification } : {}) },
        context.readerSub,
        workspaceId,
        query as Parameters<typeof searchSignalClassifications>[3],
      );
      if (result.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
      return result;
    }
    const { workspaceId: ws, ...query } = input;
    void ws;
    const result = await readSignalClassification(
      { db: deps.db, store: deps.store, ...(deps.classification ? { classification: deps.classification } : {}) },
      context.readerSub,
      workspaceId,
      query as Parameters<typeof readSignalClassification>[3],
    );
    if (result.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
    return result;
  };
}
