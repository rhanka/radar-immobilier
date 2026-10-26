import type { ObjectStore } from "../../storage/object-store.js";
import { toGraphSignalCard, toDegradedSignalCard, type DocEnrichmentContext } from "../../routes/graph-signals.js";
import type { ClassificationNode } from "./classification-population.js";
import type { SignalFacetsDto } from "./classification-contracts.js";
import type { SignalTarget } from "./target.js";
import { projectSignalCard } from "./classification-card.js";

export async function projectClassificationItem(store: ObjectStore, row: {
  node: ClassificationNode; target: SignalTarget; day: string | null; facets: SignalFacetsDto;
}, enrichment: DocEnrichmentContext, apiOrigin?: string) {
  const card = await toGraphSignalCard(store, row.node, enrichment, row.target.citySlug).catch(() => toDegradedSignalCard(row.node));
  return { target: row.target, readiness: "ready" as const, displayedFingerprint: card.facetFingerprint,
    card: projectSignalCard(card, row.day, apiOrigin), facets: row.facets };
}
