import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import { createDocEnrichmentContext, toGraphSignalCard, toDegradedSignalCard,
  type DocEnrichmentContext } from "../../routes/graph-signals.js";
import { McpSignalSearchInput, type McpSignalSearchArgs } from "../../routes/mcp-signal-search.js";
import { getSignalNodesForCity } from "../graph/graph-store.js";
import { readCoherentProjection } from "./projection-revisions.js";
import { readWorkspaceArchiveCity } from "./workspace-reader.js";
import { resolveMcpSignalWorkspace, revalidateMcpSignalWorkspace } from "./mcp-signal-workspace.js";
import { projectMcpSignalResults } from "./mcp-signal-result.js";

const targetKey = (target: { citySlug: string | null; type: string; id: string }) =>
  JSON.stringify([target.citySlug, target.type, target.id]);

/** Internal canonical cards with authorized, coherent visibility. */
export async function readMcpSignalCards(
  deps: { db: Database; store: ObjectStore; docEnrichmentBudgetMs?: number },
  sub: string, input: McpSignalSearchArgs,
) {
  const args = McpSignalSearchInput.parse(input);
  const workspaceId = await resolveMcpSignalWorkspace(deps.db, sub, args.workspaceId);
  // This variable belongs to the request, never to an individual coherent attempt.
  let enrichment: DocEnrichmentContext | undefined;
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
}

export async function searchMcpSignals(
  deps: Parameters<typeof readMcpSignalCards>[0], sub: string, input: McpSignalSearchArgs,
) {
  const result = await readMcpSignalCards(deps, sub, input);
  return { ok: true as const, workspaceId: result.workspaceId, citySlug: result.citySlug,
    signals: projectMcpSignalResults(result.cards, input) };
}
