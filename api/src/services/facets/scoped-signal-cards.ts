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
  DOC_ENRICHMENT_BUDGET_MS,
  toDegradedSignalCard,
  toGraphSignalCard,
  type GraphSignalCard,
} from "../../routes/graph-signals.js";
import {
  findDocumentMetadata,
  type DocumentMetadata,
} from "../sources/document-resolver.js";
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

function applyMetaDate(view: GraphSignalCard, rawRef: string, date: string): void {
  if (!view.publishedAt) view.publishedAt = date;
  for (const ref of view.docRefs) {
    if (ref.rawRef === rawRef && !ref.publishedAt) ref.publishedAt = date;
  }
  if (!view.evidence.documentDate) {
    view.evidence = {
      ...view.evidence,
      documentDate: date,
      completeness: {
        ...view.evidence.completeness,
        hasDocumentDate: true,
        missing: view.evidence.completeness.missing.filter((field) => field !== "documentDate"),
      },
    };
  }
  for (const refs of [view.props.refs, (view.props.properties as Record<string, unknown> | undefined)?.refs]) {
    if (!Array.isArray(refs)) continue;
    const first = refs[0];
    if (typeof first === "object" && first !== null && !Array.isArray(first)) {
      const ref = first as Record<string, unknown>;
      if (typeof ref.publishedAt !== "string") ref.publishedAt = date;
    }
  }
}

/**
 * Card views with publication dates restored (SPEC_FILTRAGE_API §3).
 * Graph-carried dates cost zero store calls. A date that lives only in S3
 * document metadata is recovered by a lightweight cached read:
 * `findDocumentMetadata` is one HEAD + one GET of the small `.meta.json`
 * sidecar per distinct rawRef (never a bucket list/scan), shared through a
 * per-request cache and bounded by the doc-enrichment budget; on budget
 * exhaustion or failure the card stays degraded (graph dates only).
 */
export async function buildScopedSignalCardViews(
  deps: ScopedSignalCardDeps, nodes: readonly StoredSignalNode[], citySlug: string,
): Promise<GraphSignalCard[]> {
  const views = nodes.map((node) => toSignalCardView(toDegradedSignalCard(node)));
  const store = deps.store;
  if (!store) return views;
  const deadlineAt = Date.now() + (deps.docEnrichmentBudgetMs ?? DOC_ENRICHMENT_BUDGET_MS);
  const cache = new Map<string, Promise<DocumentMetadata | null>>();
  const loadMeta = (rawRef: string, docSha: string): Promise<DocumentMetadata | null> => {
    const cached = cache.get(rawRef);
    if (cached) return cached;
    const pending = findDocumentMetadata(store, { rawRef, docSha }).catch((error) => {
      if (deps.onRefFailed) deps.onRefFailed(error);
      else console.error(`[scoped-signal-cards] card date read failed (city=${citySlug} ref=${rawRef}):`, error);
      return null;
    });
    cache.set(rawRef, pending);
    return pending;
  };
  await Promise.all(views.map(async (view) => {
    if (view.publishedAt && view.evidence.documentDate) return;
    if (Date.now() >= deadlineAt) return;
    const ref = view.docRefs.find((candidate) => candidate.rawRef);
    if (!ref?.rawRef) return;
    const meta = await loadMeta(ref.rawRef, ref.docSha);
    if (!meta?.publishedAt) return;
    applyMetaDate(view, ref.rawRef, meta.publishedAt);
  }));
  return views;
}

/** Legacy A authority derived from the same served cards (exact signal ids). */
export function scopedLegacyProjection(cards: readonly GraphSignalCard[]): LegacyZmpProjection {
  return buildLegacyZmpProjection(cards.map((card) => card.legacySubset));
}
