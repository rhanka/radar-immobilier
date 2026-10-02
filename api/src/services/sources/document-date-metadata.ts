import { DocumentDateSchema, RawDocumentRecordSchema, rawMetaKey, resolveDocumentDate,
  type DocumentDate, type RawDocumentRecord } from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";
import type { GraphifyGraph, GraphifyNode } from "../graph/graph-store.js";
import { loadDocumentMetadata, normalizeRawRef, type DocumentMetadata } from "./document-resolver.js";

export function applyDocumentDate(record: RawDocumentRecord, date: DocumentDate): RawDocumentRecord {
  const updated = { ...record, documentDate: date };
  delete updated.publishedAt;
  if (date.status === "known") updated.publishedAt = date.value;
  return RawDocumentRecordSchema.parse(updated);
}

/**
 * Enrich only missing metadata; preserve source identity and the first fetchedAt.
 * An existing sidecar that is not a valid RawDocumentRecord is left byte-for-byte untouched
 * (returns null): enrichment never rewrites metadata it cannot fully validate.
 */
export async function persistDocumentDate(store: ObjectStore, rawRef: string, candidate: DocumentDate,
  collected?: RawDocumentRecord): Promise<RawDocumentRecord | null> {
  const key = rawMetaKey(rawRef);
  const exists = await store.head(key);
  const original = exists ? RawDocumentRecordSchema.safeParse(JSON.parse(new TextDecoder()
    .decode(await store.get(key)))) : null;
  if (original && !original.success) return null;
  const record = original?.success ? original.data : collected;
  if (!record) return null;
  if (record.storageKey !== rawRef || rawRef.match(/\/([a-f0-9]{64})\.[a-z0-9]+$/)?.[1] !== record.sha256) {
    throw new Error(`Documentary metadata identity mismatch for ${rawRef}`);
  }
  const current = resolveDocumentDate(record);
  const date = current.status !== "unknown" ? current : DocumentDateSchema.parse(candidate);
  const updated = applyDocumentDate(record, date);
  if (!exists || JSON.stringify(updated) !== JSON.stringify(record)) {
    await store.put(key, JSON.stringify(updated, null, 2), "application/json");
  }
  return updated;
}

/** Read-only, replayable stock decision; callers provide exact identity-matched manifest dates. */
export function previewDocumentDateRecovery(record: RawDocumentRecord, manifestDates: readonly string[],
  extracted: DocumentDate = { status: "unknown" }) {
  const current = resolveDocumentDate(record);
  const candidates = [...new Set([...(current.status === "known" ? [current.value] : []),
    ...manifestDates.filter((value) => DocumentDateSchema.safeParse({ status: "known", value,
      precision: value.length === 7 ? "month" : "day", kind: "document", method: "manifest",
      evidence: { field: "publishedAt" } }).success)])];
  if (current.status === "ambiguous" || candidates.length > 1) return { rawRef: record.storageKey,
    status: "conflict" as const, candidates };
  if (current.status === "known") return { rawRef: record.storageKey, status: "preserved" as const,
    documentDate: current };
  const value = candidates[0];
  const date: DocumentDate = value ? { status: "known", value,
    precision: value.length === 7 ? "month" : "day", kind: "document", method: "manifest",
    evidence: { field: "publishedAt" } } : extracted;
  return { rawRef: record.storageKey, status: date.status === "known" ? "recoverable" as const
    : date.status === "ambiguous" ? "conflict" as const : "unknown" as const, documentDate: date };
}

/** Existing refresh publication owns the resulting graph; no separate index or writer. */
export async function hydrateGraphDocumentDates(store: ObjectStore, graph: GraphifyGraph): Promise<GraphifyGraph> {
  const metadataByRef = new Map<string, Promise<DocumentMetadata | null>>();
  async function metadataFor(rawRef: string): Promise<DocumentMetadata | null> {
    let pending = metadataByRef.get(rawRef);
    if (!pending) { pending = loadDocumentMetadata(store, rawRef); metadataByRef.set(rawRef, pending); }
    const metadata = await pending;
    return metadata?.rawRef === rawRef ? metadata : null;
  }
  /** A previously undated native Source takes the same day-precision date as its metadata. */
  async function hydrateSource(node: GraphifyNode): Promise<GraphifyNode> {
    if ((node.type ?? node.file_type) !== "Source" || !node.properties) return node;
    const properties = node.properties;
    if (properties["date"] !== undefined) return node;
    const firstRef = Array.isArray(node.refs) ? node.refs.find((ref) => ref && typeof ref === "object"
      && typeof (ref as Record<string, unknown>)["rawRef"] === "string") as Record<string, unknown> | undefined
      : undefined;
    const candidate = typeof properties["rawRef"] === "string" ? properties["rawRef"] : firstRef?.["rawRef"];
    const rawRef = typeof candidate === "string" ? normalizeRawRef(candidate) : null;
    const metadata = rawRef ? await metadataFor(rawRef) : null;
    const sha = properties["docSha"] ?? properties["sha256"];
    if (!metadata || (sha !== undefined && sha !== metadata.docSha)) return node;
    const date = metadata.documentDate;
    if (date.status !== "known" || date.precision !== "day") return node;
    return { ...node, properties: { ...properties, date: date.value } };
  }
  async function hydrateRefs(refs: unknown): Promise<unknown> {
    if (!Array.isArray(refs)) return refs;
    return Promise.all(refs.map(async (ref: unknown) => {
      if (!ref || typeof ref !== "object" || Array.isArray(ref)) return ref;
      const value = ref as Record<string, unknown>;
      const rawRef = typeof value["rawRef"] === "string" ? normalizeRawRef(value["rawRef"]) : null;
      if (!rawRef) return ref;
      const metadata = await metadataFor(rawRef);
      if (!metadata || (value["docSha"] && value["docSha"] !== metadata.docSha)) return ref;
      const date = metadata.documentDate.status === "unknown" ? resolveDocumentDate(value) : metadata.documentDate;
      const updated: Record<string, unknown> = { ...value, documentDate: date, fetchedAt: metadata.fetchedAt };
      delete updated["publishedAt"];
      if (date.status === "known") updated["publishedAt"] = date.value;
      return updated;
    }));
  }
  async function hydrate<T extends { refs?: unknown; properties?: unknown }>(entity: T): Promise<T> {
    const refs = await hydrateRefs(entity.refs);
    const properties = entity.properties && typeof entity.properties === "object"
      ? entity.properties as Record<string, unknown> : undefined;
    return { ...entity, ...(refs ? { refs } : {}), ...(properties && Array.isArray(properties["refs"])
      ? { properties: { ...properties, refs: await hydrateRefs(properties["refs"]) } } : {}) };
  }
  const nodes = [];
  for (const node of graph.nodes) nodes.push(await hydrateSource(await hydrate(node)));
  const edges = [];
  for (const edge of graph.edges ?? []) edges.push(await hydrate(edge));
  const links = [];
  for (const link of graph.links ?? []) links.push(await hydrate(link));
  return { ...graph, nodes, ...(graph.edges ? { edges } : {}), ...(graph.links ? { links } : {}) };
}
