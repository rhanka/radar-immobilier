import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetActivationState } from "../../db/schema.js";
import type { ObjectStore } from "../../storage/object-store.js";
import { createDocEnrichmentContext, readGraphSignalCards, toGraphSignalCard, toDegradedSignalCard,
  type DocEnrichmentContext } from "../../routes/graph-signals.js";
import { McpSignalSearchInput, type McpSignalSearchArgs } from "../../routes/mcp-signal-search.js";
import { getSignalNodesForCity } from "../graph/graph-store.js";
import { readCoherentProjection } from "./projection-revisions.js";
import { readWorkspaceArchiveCity } from "./workspace-reader.js";
import { resolveMcpSignalWorkspace, revalidateMcpSignalWorkspace } from "./mcp-signal-workspace.js";
import { projectMcpSignalResults } from "./mcp-signal-result.js";
import { EMPTY_DISCARDED_KEYS, EMPTY_DISCARDED_SIGNALS, type DiscardedSignalsPort } from "../graph/discarded-signals.js";
import { legacyFenceError, legacyFenceStatus, type LegacyRetirementState } from "./legacy-retirement.js";
import { LEGACY_EPOCH, SCOPED_EPOCH, ScopeError, maintenanceScopeError } from "./scope.js";

const targetKey = (target: { citySlug: string | null; type: string; id: string }) =>
  JSON.stringify([target.citySlug, target.type, target.id]);

/**
 * Internal canonical cards with authorized, coherent visibility.
 * When boundWorkspaceId is set, the caller owns the workspace binding and
 * this reader never resolves again; it only revalidates the full set.
 */
export async function readMcpSignalCards(
  deps: { db: Database; store: ObjectStore; docEnrichmentBudgetMs?: number },
  sub: string, input: McpSignalSearchArgs,
  boundWorkspaceId?: string,
) {
  const args = McpSignalSearchInput.parse(input);
  const workspaceId = boundWorkspaceId
    ?? await resolveMcpSignalWorkspace(deps.db, sub, args.workspaceId);
  // This variable belongs to the request, never to an individual coherent attempt.
  let enrichment: DocEnrichmentContext | undefined;
  if (boundWorkspaceId !== undefined) await revalidateMcpSignalWorkspace(deps.db, sub, workspaceId, args.workspaceId);
  try {
    const coherent = await readCoherentProjection(deps.db, sub, workspaceId, args.city, "signal", async () => {
      const archive = await readWorkspaceArchiveCity(deps.db, sub, workspaceId, args.city);
      const stored = await getSignalNodesForCity(deps.db, args.city);
      const hidden = new Set(archive.filter((row) => row.effectiveDiscarded).map((row) => targetKey(row.target)));
      const visible = stored.filter((node) => args.showDiscarded || !hidden.has(targetKey(node)));
      if (visible.length > 0) enrichment ??= createDocEnrichmentContext(deps.docEnrichmentBudgetMs);
      const cards = await Promise.all(visible.map((node) =>
        toGraphSignalCard(deps.store, node, enrichment!, args.city).catch((error) => {
          console.error("[mcp-signal-search] canonical card degraded:", error);
          return toDegradedSignalCard(node);
        })));
      await revalidateMcpSignalWorkspace(deps.db, sub, workspaceId, args.workspaceId);
      return cards;
    });
    await revalidateMcpSignalWorkspace(deps.db, sub, workspaceId, args.workspaceId);
    return { workspaceId, citySlug: args.city, cards: coherent.payload };
  } catch (error) {
    if (error instanceof ScopeError && error.status === 503
      && error.message.startsWith("scoped_facet_scope_unavailable:")
      && await isMaintenanceBarrier(deps.db, workspaceId)) {
      throw new ScopeError(503, maintenanceScopeError(workspaceId));
    }
    throw error;
  }
}

export class McpSignalLegacyFenceError extends Error {
  constructor(public status: 503 | 410) { super(legacyFenceError(status)); }
}

async function isMaintenanceBarrier(db: Database, workspaceId: string): Promise<boolean> {
  const [row] = await db.select().from(facetActivationState)
    .where(eq(facetActivationState.workspaceId, workspaceId));
  return row?.maintenanceBarrier === true;
}

/** Sample the raw epoch: an absent row must never hide a maintenance barrier. */
async function searchEpoch(db: Database, workspaceId: string) {
  const [row] = await db.select().from(facetActivationState)
    .where(eq(facetActivationState.workspaceId, workspaceId));
  if (row?.maintenanceBarrier) {
    throw new ScopeError(503, maintenanceScopeError(workspaceId));
  }
  if (row && row.writerEpoch !== SCOPED_EPOCH
    && (row.writerEpoch !== LEGACY_EPOCH || row.oldIndexDropped)) {
    throw new ScopeError(503, `scoped_facet_scope_unavailable:${workspaceId}`);
  }
  return row?.writerEpoch ?? LEGACY_EPOCH;
}

/** Delivery precedes activation; the selected epoch owns the only reader used. */
export async function searchMcpSignals(
  deps: Parameters<typeof readMcpSignalCards>[0] & {
    discarded?: DiscardedSignalsPort; legacyRetirement?: LegacyRetirementState;
    afterWorkspaceResolve?: () => Promise<void> | void;
  }, sub: string, input: McpSignalSearchArgs,
) {
  const args = McpSignalSearchInput.parse(input);
  const workspaceId = await resolveMcpSignalWorkspace(deps.db, sub, args.workspaceId);
  await deps.afterWorkspaceResolve?.();
  const epoch = await searchEpoch(deps.db, workspaceId);
  let result;
  if (epoch === SCOPED_EPOCH) {
    result = await readMcpSignalCards(deps, sub, args, workspaceId);
  } else {
    const fence = legacyFenceStatus(deps.legacyRetirement);
    if (fence !== null) throw new McpSignalLegacyFenceError(fence);
    const cards = await readGraphSignalCards(deps, args.city, () => args.showDiscarded
      ? Promise.resolve(EMPTY_DISCARDED_KEYS)
      : (deps.discarded ?? EMPTY_DISCARDED_SIGNALS).forViewer(sub));
    await revalidateMcpSignalWorkspace(deps.db, sub, workspaceId, args.workspaceId);
    if (await searchEpoch(deps.db, workspaceId) !== epoch) {
      throw new ScopeError(503, "signal_search_epoch_changed");
    }
    result = { workspaceId, citySlug: args.city, cards };
  }
  return { ok: true as const, workspaceId: result.workspaceId, citySlug: result.citySlug,
    signals: projectMcpSignalResults(result.cards, args) };
}
