import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { graphNodes } from "../../db/schema.js";
import { createDocEnrichmentContext } from "../../routes/graph-signals.js";
import { StateQuery, NativeTarget, WorkspaceId } from "./classification-query.js";
import { SignalFacets, Snapshot } from "./classification-contracts.js";
import { SignalItem } from "./classification-search-contract.js";
import { ClassificationError } from "./classification-errors.js";
import { readClassificationHeads, projectFacets } from "./classification-heads.js";
import { readClassificationProjection } from "./classification-projection.js";
import { boundedClassificationJson, type ClassificationReadDeps } from "./classification-search.js";
import { classificationDay } from "./classification-order.js";
import { projectClassificationItem } from "./classification-item.js";

export const SignalStateResponse = z.object({ ok: z.literal(true), contractVersion: z.literal("signal-state-v1"),
  workspaceId: WorkspaceId, snapshot: Snapshot, item: z.union([SignalItem,
    z.object({ target: NativeTarget, readiness: z.literal("source_unavailable"), displayedFingerprint: z.null(),
      card: z.null(), facets: SignalFacets }).strict()]),
}).strict();
export async function readSignalClassification(deps: ClassificationReadDeps, sub: string, workspaceId: string, input: z.infer<typeof StateQuery>) {
  const query = StateQuery.parse(input);
  const target = NativeTarget.parse({ citySlug: query.citySlug, type: query.type, id: query.id });
  const enrichment = createDocEnrichmentContext(2000);
  const result = await readClassificationProjection(deps.db, sub, workspaceId, query.citySlug,
    { target, reveal: query.reveal }, async () => {
      const heads = await readClassificationHeads(deps.db, sub, workspaceId, query.citySlug);
      const facets = projectFacets(heads, target);
      const [node] = await deps.db.select().from(graphNodes).where(and(eq(graphNodes.citySlug, target.citySlug),
        eq(graphNodes.type, target.type), eq(graphNodes.id, target.id)));
      if (!node) {
        if (facets.personalHistoryState === "untouched" && facets.archive.workspace === null) {
          throw new ClassificationError("target_not_found");
        }
        return { target, readiness: "source_unavailable" as const, displayedFingerprint: null, card: null, facets };
      }
      if (facets.effectiveHidden && !query.reveal) throw new ClassificationError("reveal_required");
      return projectClassificationItem(deps.store, { node, target, day: classificationDay(node.props), facets },
        enrichment, deps.classification?.apiOrigin);
    });
  const response = SignalStateResponse.parse({ ok: true, contractVersion: "signal-state-v1", workspaceId,
    snapshot: result.snapshot, item: result.payload });
  boundedClassificationJson(response);
  return response;
}
