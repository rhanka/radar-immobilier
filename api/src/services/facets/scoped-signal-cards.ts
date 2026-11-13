/**
 * Scoped signal cards: the server card fields (description, evidence,
 * vivier_v2 classification, legacy Z/M/P membership, B' classification)
 * built by the same canonical builder the scoped MCP facade uses, for the
 * nodes a scoped read already authorized. Nothing is invented: each card is
 * derived from its stored node; S3 document metadata is bounded by the doc
 * enrichment budget and a failed card degrades to its node-only version.
 */
import type { ObjectStore } from "../../storage/object-store.js";
import type { Database } from "../../db/client.js";
import { readClassAnnotations } from "../graph/class-annotations.js";
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
  db?: Database;
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
  const annotations = deps.db ? await readClassAnnotations(deps.db, citySlug) : new Map();
  const annotate = (cards: GraphSignalCard[]) => cards.map((card) => ({ ...card,
    ...(annotations.has(`${card.type}:${card.id}`) ? { classAnnotation: annotations.get(`${card.type}:${card.id}`) } : {}),
  }));
  const store = deps.store;
  if (!store) return annotate(nodes.map((node) => toDegradedSignalCard(node)));
  if (nodes.length === 0) return [];
  const enrichment = createDocEnrichmentContext(deps.docEnrichmentBudgetMs);
  return annotate(await Promise.all(nodes.map((node) =>
    toGraphSignalCard(store, node, enrichment, citySlug, deps.onRefFailed).catch((error) => {
      if (deps.onDegraded) {
        deps.onDegraded(error);
        return toDegradedSignalCard(node);
      }
      console.error(`[scoped-signal-cards] card degraded (city=${citySlug} node=${node.id}):`, error);
      return toDegradedSignalCard(node);
    }))));
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
  // Projected props refs carry no rawRef: attribute only at the position of
  // the loaded docRef, and only when both arrays align (same length).
  const loadedIndex = view.docRefs.findIndex((ref) => ref.rawRef === rawRef);
  if (loadedIndex < 0) return;
  for (const refs of [view.props.refs, (view.props.properties as Record<string, unknown> | undefined)?.refs]) {
    if (!Array.isArray(refs) || refs.length !== view.docRefs.length) continue;
    const item = refs[loadedIndex];
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const ref = item as Record<string, unknown>;
      if (typeof ref.publishedAt !== "string") ref.publishedAt = date;
    }
  }
}

export const SCOPED_CARD_ENRICHMENT_CONCURRENCY = 8;

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
  const annotations = deps.db ? await readClassAnnotations(deps.db, citySlug) : new Map();
  const views = nodes.map((node) => ({ ...toSignalCardView(toDegradedSignalCard(node)),
    ...(annotations.has(`${node.type}:${node.id}`) ? { classAnnotation: annotations.get(`${node.type}:${node.id}`) } : {}),
  }));
  const store = deps.store;
  if (!store) return views;
  const budgetMs = deps.docEnrichmentBudgetMs ?? DOC_ENRICHMENT_BUDGET_MS;
  // Real bound on in-flight reads: one AbortController aborted at the global
  // deadline (forwarded to the store, so S3 sends are cancelled), a race
  // against that same signal for stores that ignore it, and a semaphore
  // capping concurrent distinct-ref reads. Past the deadline the signal is
  // aborted, queued reads never start, and cards stay date-less.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, budgetMs));
  (timer as { unref?: () => void }).unref?.();
  const deadline = new Promise<null>((resolve) => {
    if (controller.signal.aborted) resolve(null);
    else controller.signal.addEventListener("abort", () => resolve(null), { once: true });
  });
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = (): Promise<boolean> => {
    if (controller.signal.aborted) return Promise.resolve(false);
    if (active < SCOPED_CARD_ENRICHMENT_CONCURRENCY) { active++; return Promise.resolve(true); }
    return new Promise<boolean>((resolve) => {
      const wake = () => {
        controller.signal.removeEventListener("abort", onAbort);
        if (controller.signal.aborted) resolve(false);
        else { active++; resolve(true); }
      };
      const onAbort = () => {
        const at = waiters.indexOf(wake);
        if (at >= 0) waiters.splice(at, 1);
        resolve(false);
      };
      waiters.push(wake);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  const release = () => { active--; waiters.shift()?.(); };
  const cache = new Map<string, Promise<DocumentMetadata | null>>();
  const loadMeta = (rawRef: string, docSha: string): Promise<DocumentMetadata | null> => {
    const cached = cache.get(rawRef);
    if (cached) return cached;
    const pending = (async (): Promise<DocumentMetadata | null> => {
      if (!await acquire()) return null;
      try {
        if (controller.signal.aborted) return null;
        const read = findDocumentMetadata(store, { rawRef, docSha, signal: controller.signal }).catch((error) => {
          if (controller.signal.aborted) return null;
          if (deps.onRefFailed) deps.onRefFailed(error);
          else console.error(`[scoped-signal-cards] card date read failed (city=${citySlug} ref=${rawRef}):`, error);
          return null;
        });
        return await Promise.race([read, deadline]);
      } finally { release(); }
    })();
    cache.set(rawRef, pending);
    return pending;
  };
  try {
    await Promise.all(views.map(async (view) => {
      if (view.publishedAt && view.evidence.documentDate) return;
      for (const ref of view.docRefs) {
        if (controller.signal.aborted) return;
        if (!ref.rawRef) continue;
        const meta = await loadMeta(ref.rawRef, ref.docSha);
        if (!meta?.publishedAt) continue;
        applyMetaDate(view, ref.rawRef, meta.publishedAt);
        break;
      }
    }));
  } finally { clearTimeout(timer); }
  return views;
}

/** Legacy A authority derived from the same served cards (exact signal ids). */
export function scopedLegacyProjection(cards: readonly GraphSignalCard[]): LegacyZmpProjection {
  return buildLegacyZmpProjection(cards.map((card) => card.legacySubset));
}
