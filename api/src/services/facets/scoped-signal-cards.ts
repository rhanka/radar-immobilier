/**
 * Scoped signal cards: the server card fields (description, evidence,
 * vivier_v2 classification, legacy Z/M/P membership, B' classification)
 * built by the same canonical builder the scoped MCP facade uses, for the
 * nodes a scoped read already authorized. Nothing is invented: each card is
 * derived from its stored node; S3 document metadata is bounded by the doc
 * enrichment budget and a failed card degrades to its node-only version.
 */
import type { ObjectStore } from "../../storage/object-store.js";
import {
  createDocEnrichmentContext,
  toDegradedSignalCard,
  toGraphSignalCard,
  type GraphSignalCard,
} from "../../routes/graph-signals.js";
import { buildLegacyZmpProjection, type LegacyZmpProjection } from "../graph/vivier-v2.js";
import { projectProps } from "./props-projection.js";

export type StoredSignalNode = Parameters<typeof toDegradedSignalCard>[0];

export interface ScopedSignalCardDeps {
  store?: ObjectStore;
  docEnrichmentBudgetMs?: number;
  /**
   * Degraded-card journal. Defaults to the app log line (city + node id);
   * reader ops pass a typed line without business data (J1.2d/e §0.4).
   */
  onDegraded?: (error: unknown) => void;
  /**
   * Per-ref S3 enrichment failure journal, forwarded to `toGraphSignalCard`.
   * Absent, the app log line (city, node, ref); reader ops pass a typed one.
   */
  onRefFailed?: (error: unknown) => void;
}

export async function buildScopedSignalCards(
  deps: ScopedSignalCardDeps, nodes: readonly StoredSignalNode[], citySlug: string,
): Promise<GraphSignalCard[]> {
  const store = deps.store;
  if (!store) return nodes.map((node) => toDegradedSignalCard(node));
  if (nodes.length === 0) return [];
  const enrichment = createDocEnrichmentContext(deps.docEnrichmentBudgetMs);
  return Promise.all(nodes.map((node) =>
    toGraphSignalCard(store, node, enrichment, citySlug, deps.onRefFailed).catch((error) => {
      if (deps.onDegraded) {
        deps.onDegraded(error);
        return toDegradedSignalCard(node);
      }
      console.error(`[scoped-signal-cards] card degraded (city=${citySlug} node=${node.id}):`, error);
      return toDegradedSignalCard(node);
    })));
}

/** Thin card view (SPEC_FILTRAGE_API §3): closed props projection, no S3. */
export function toSignalCardView(card: GraphSignalCard): GraphSignalCard {
  return { ...card, props: projectProps(card.props) };
}

/** Legacy A authority derived from the same served cards (exact signal ids). */
export function scopedLegacyProjection(cards: readonly GraphSignalCard[]): LegacyZmpProjection {
  return buildLegacyZmpProjection(cards.map((card) => card.legacySubset));
}
