import type { Database } from "../../db/client.js";
import { McpSignalSearchInput, type McpSignalSearchArgs } from "../../routes/mcp-signal-search.js";
import { getSignalNodesForCity } from "../graph/graph-store.js";
import { readCoherentProjection } from "./projection-revisions.js";
import { readWorkspaceArchiveCity } from "./workspace-reader.js";
import { resolveMcpSignalWorkspace, revalidateMcpSignalWorkspace } from "./mcp-signal-workspace.js";

const targetKey = (target: { citySlug: string | null; type: string; id: string }) =>
  JSON.stringify([target.citySlug, target.type, target.id]);

/** Internal card population. Domain normalization and production mounting are separate slices. */
export async function readMcpSignalCards(
  deps: { db: Database }, sub: string, input: McpSignalSearchArgs,
) {
  const args = McpSignalSearchInput.parse(input);
  const workspaceId = await resolveMcpSignalWorkspace(deps.db, sub, args.workspaceId);
  const coherent = await readCoherentProjection(deps.db, sub, workspaceId, args.city, "signal", async () => {
    const archive = await readWorkspaceArchiveCity(deps.db, sub, workspaceId, args.city);
    const stored = await getSignalNodesForCity(deps.db, args.city);
    const hidden = new Set(archive.filter((row) => row.effectiveDiscarded).map((row) => targetKey(row.target)));
    const cards = stored.filter((node) => args.showDiscarded || !hidden.has(targetKey(node)));
    await revalidateMcpSignalWorkspace(deps.db, sub, workspaceId, args.workspaceId);
    return cards;
  });
  await revalidateMcpSignalWorkspace(deps.db, sub, workspaceId, args.workspaceId);
  return { workspaceId, citySlug: args.city, cards: coherent.payload };
}
