/**
 * WP A.3.x — Graph-signals read routes.
 *
 * Expose Signal and DesignationEvent nodes from graph_nodes as a T1 signal
 * feed — the REAL graphify pipeline (1 141 nodes / ~197 villes), NOT the old
 * ontology project-state (9 pilot cities only).
 *
 * GET /api/graph-signals/by-city
 *   Returns aggregate signal counts per city.
 *   Response: { ok: true, totalCount, cities: [{ citySlug, signalCount, subsetCounts }] }
 *
 * GET /api/graph-signals/:city
 *   Returns Signal + DesignationEvent nodes for one city.
 *   Response: { ok: true, citySlug, nodes: [{ id, type, label, citySlug, sourceRef, createdAt, props }] }
 *   Returns 404 when no signal nodes exist for the city.
 */

import { Hono } from "hono";
import {
  getSignalNodesForCity,
  listCitiesWithSignalNodes,
} from "../services/graph/graph-store.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import {
  apiDocumentUrl,
  findDocumentMetadata,
  normalizeRawRef,
  type DocumentMetadata,
} from "../services/sources/document-resolver.js";

export interface GraphSignalsDeps {
  db: Database;
  store: ObjectStore;
}

export interface GraphSignalDocRef {
  docSha: string;
  excerpt?: string;
  page?: number;
  sourceUrl?: string;
  rawRef?: string;
  documentUrl?: string;
  title?: string;
  contentType?: string;
  fetchedAt?: string;
  publishedAt?: string;
  bbox?: unknown;
}

export interface GraphSignalCard {
  id: string;
  type: string;
  label: string;
  citySlug: string | null;
  sourceRef: string | null;
  createdAt: string | null;
  description: string | null;
  publishedAt: string | null;
  docRefs: GraphSignalDocRef[];
  evidence: SignalEvidence;
  props: Record<string, unknown>;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function nodeDescription(props: Record<string, unknown>): string | null {
  const topLevel = firstString(props, ["description", "summary", "details"]);
  if (topLevel) return topLevel;
  const nested = props.properties;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    return firstString(nested as Record<string, unknown>, ["description", "summary", "details"]);
  }
  return null;
}

function parseDocRefRecord(item: unknown, fallbackId: string): GraphSignalDocRef | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  const excerpt = firstString(r, ["excerpt", "citation", "quote", "text", "selection", "highlight"]);
  const sourceUrl = firstString(r, [
    "sourceUrl",
    "source_url",
    "pdfUrl",
    "pdf_url",
    "url",
    "href",
  ]);
  const documentUrl = firstString(r, ["documentUrl", "document_url", "apiUrl", "api_url"]);
  const rawRef = firstString(r, [
    "rawRef",
    "raw_ref",
    "file",
    "ref",
    "sourceRef",
    "source_ref",
    "path",
    "s3Key",
    "s3_key",
  ]);
  const docSha = firstString(r, [
    "docSha",
    "doc_sha",
    "sha",
    "sha256",
    "hash",
    "documentSha",
    "document_sha",
    "file",
    "ref",
    "sourceRef",
    "source_ref",
  ]);
  const page = firstNumber(r, ["page", "pageNumber", "page_number"]);
  const bbox = r.bbox ?? r.boundingBox ?? r.bounding_box;

  if (!docSha && !excerpt && !sourceUrl && !rawRef && !documentUrl) return null;

  return {
    docSha: docSha ?? rawRef ?? sourceUrl ?? documentUrl ?? fallbackId,
    ...(excerpt !== null ? { excerpt } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(sourceUrl !== null ? { sourceUrl } : {}),
    ...(rawRef !== null ? { rawRef } : {}),
    ...(documentUrl !== null ? { documentUrl } : {}),
    ...(bbox !== undefined ? { bbox } : {}),
  };
}

function extractDocRefs(
  props: Record<string, unknown>,
  sourceRef: string | null,
): GraphSignalDocRef[] {
  const result: GraphSignalDocRef[] = [];
  const rawRefs = props.refs;

  if (Array.isArray(rawRefs)) {
    rawRefs.forEach((item, index) => {
      const parsed = parseDocRefRecord(item, `ref-${index + 1}`);
      if (parsed) result.push(parsed);
    });
  }

  const topLevel = parseDocRefRecord(props, "citation");
  if (topLevel) result.push(topLevel);

  // Lit aussi le bloc imbriqué props.properties (structure « rimouski » : tout
  // le docSha/citation/rawRef vit dans properties, sans props.refs ni top-level).
  const nested = props.properties;
  if (isRecord(nested)) {
    if (Array.isArray(nested.refs)) {
      nested.refs.forEach((item, index) => {
        const parsed = parseDocRefRecord(item, `nested-ref-${index + 1}`);
        if (parsed) result.push(parsed);
      });
    }
    const nestedTop = parseDocRefRecord(nested, "nested-citation");
    if (nestedTop) result.push(nestedTop);
  }

  if (sourceRef && result.length === 0) {
    result.push({ docSha: sourceRef, rawRef: sourceRef });
  }

  const seen = new Set<string>();
  return result.filter((ref) => {
    const key = [
      ref.docSha,
      ref.page ?? "",
      ref.sourceUrl ?? "",
      ref.rawRef ?? "",
      ref.documentUrl ?? "",
      ref.excerpt ?? "",
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyMetadata(ref: GraphSignalDocRef, meta: DocumentMetadata | null): GraphSignalDocRef {
  if (!meta) {
    const normalizedRawRef = ref.rawRef ? normalizeRawRef(ref.rawRef) : null;
    return normalizedRawRef && !ref.sourceUrl
      ? { ...ref, rawRef: normalizedRawRef, documentUrl: apiDocumentUrl(normalizedRawRef) }
      : ref;
  }

  return {
    ...ref,
    docSha: meta.docSha,
    rawRef: meta.rawRef,
    sourceUrl: ref.sourceUrl ?? meta.sourceUrl,
    documentUrl: apiDocumentUrl(meta.rawRef),
    contentType: meta.contentType,
    fetchedAt: meta.fetchedAt,
    ...(meta.title !== undefined ? { title: meta.title } : {}),
    ...(meta.publishedAt !== undefined ? { publishedAt: meta.publishedAt } : {}),
  };
}

async function enrichDocRefs(
  store: ObjectStore,
  refs: readonly GraphSignalDocRef[],
): Promise<GraphSignalDocRef[]> {
  const cache = new Map<string, Promise<DocumentMetadata | null>>();

  return Promise.all(
    refs.map(async (ref) => {
      const key = `${ref.rawRef ?? ""}\u0000${ref.docSha}`;
      if (!cache.has(key)) {
        cache.set(
          key,
          findDocumentMetadata(store, {
            ...(ref.rawRef !== undefined ? { rawRef: ref.rawRef } : {}),
            docSha: ref.docSha,
          }),
        );
      }
      return applyMetadata(ref, await cache.get(key)!);
    }),
  );
}

async function toGraphSignalCard(
  store: ObjectStore,
  node: Awaited<ReturnType<typeof getSignalNodesForCity>>[number],
): Promise<GraphSignalCard> {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const docRefs = await enrichDocRefs(store, extractDocRefs(props, node.sourceRef));
  const firstPublishedAt =
    docRefs.find((ref) => ref.publishedAt !== undefined)?.publishedAt ?? null;
  const evidence = mergeEvidenceWithDocRefs(
    buildEvidence({
      props,
      sourceRef: node.sourceRef,
    }),
    docRefs,
    firstPublishedAt,
  );

  return {
    id: node.id,
    type: node.type,
    label: node.label,
    citySlug: node.citySlug,
    sourceRef: node.sourceRef,
    createdAt: node.createdAt ? node.createdAt.toISOString() : null,
    description: nodeDescription(props),
    publishedAt: firstPublishedAt,
    docRefs,
    evidence,
    props,
  };
}

export type EvidenceMissingField =
  | "description"
  | "citation"
  | "pdfLink"
  | "documentDate"
  | "page"
  | "bbox";

export interface EvidenceCompleteness {
  hasDescription: boolean;
  hasCitationExcerpt: boolean;
  hasPdfLink: boolean;
  hasDocumentDate: boolean;
  hasPage: boolean;
  hasBbox: boolean;
  missing: EvidenceMissingField[];
}

export interface SignalEvidenceRef {
  docSha: string | null;
  citation: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  rawRef: string | null;
  rawObjectKey: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
}

export interface SignalEvidence {
  description: string | null;
  citation: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  rawRef: string | null;
  rawObjectKey: string | null;
  sourceRef: string | null;
  documentDate: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  refs: SignalEvidenceRef[];
  completeness: EvidenceCompleteness;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(readNumber);
  return numbers.every((n): n is number => n !== null)
    ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!]
    : null;
}

function firstEvidenceString(values: readonly unknown[]): string | null {
  for (const value of values) {
    const str = readString(value);
    if (str) return str;
  }
  return null;
}

function firstEvidenceNumber(values: readonly unknown[]): number | null {
  for (const value of values) {
    const number = readNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function firstEvidenceBbox(values: readonly unknown[]): [number, number, number, number] | null {
  for (const value of values) {
    const bbox = readBbox(value);
    if (bbox) return bbox;
  }
  return null;
}

function nestedProperties(props: Record<string, unknown>): Record<string, unknown> {
  return isRecord(props.properties) ? props.properties : {};
}

function isUrlLike(value: string | null): boolean {
  return value !== null && /^(?:https?:)?\/\//u.test(value);
}

function extractEvidenceRefs(props: Record<string, unknown>): SignalEvidenceRef[] {
  const raw = props.refs;
  if (!Array.isArray(raw)) return [];

  const refs: SignalEvidenceRef[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const rawRef = readString(item);
      if (rawRef) {
        refs.push({
          docSha: null,
          citation: null,
          excerpt: null,
          sourceUrl: isUrlLike(rawRef) ? rawRef : null,
          documentUrl: isUrlLike(rawRef) ? rawRef : null,
          rawRef: isUrlLike(rawRef) ? null : rawRef,
          rawObjectKey: null,
          page: null,
          bbox: null,
        });
      }
      continue;
    }
    if (!isRecord(item)) continue;

    const sourceUrl = firstEvidenceString([item.sourceUrl, item.url]);
    const documentUrl = firstEvidenceString([item.documentUrl, sourceUrl]);
    const rawRef = firstEvidenceString([item.rawRef, item.ref]);
    const rawObjectKey = firstEvidenceString([
      item.rawObjectKey,
      item.storageKey,
      item.casKey,
    ]);
    const excerpt = firstEvidenceString([item.excerpt, item.citation]);
    const citation = firstEvidenceString([item.citation, excerpt]);
    const ref: SignalEvidenceRef = {
      docSha: firstEvidenceString([item.docSha, item.sha256]),
      citation,
      excerpt,
      sourceUrl,
      documentUrl,
      rawRef,
      rawObjectKey,
      page: firstEvidenceNumber([item.page]),
      bbox: firstEvidenceBbox([item.bbox]),
    };

    if (
      ref.docSha ||
      ref.citation ||
      ref.excerpt ||
      ref.sourceUrl ||
      ref.documentUrl ||
      ref.rawRef ||
      ref.rawObjectKey ||
      ref.page !== null ||
      ref.bbox
    ) {
      refs.push(ref);
    }
  }
  return refs;
}

function buildCompleteness(evidence: Omit<SignalEvidence, "completeness">): EvidenceCompleteness {
  const completeness: EvidenceCompleteness = {
    hasDescription: evidence.description !== null,
    hasCitationExcerpt: evidence.citation !== null || evidence.excerpt !== null,
    hasPdfLink:
      evidence.sourceUrl !== null ||
      evidence.documentUrl !== null ||
      evidence.rawRef !== null ||
      evidence.rawObjectKey !== null ||
      evidence.sourceRef !== null,
    hasDocumentDate: evidence.documentDate !== null,
    hasPage: evidence.page !== null,
    hasBbox: evidence.bbox !== null,
    missing: [],
  };

  if (!completeness.hasDescription) completeness.missing.push("description");
  if (!completeness.hasCitationExcerpt) completeness.missing.push("citation");
  if (!completeness.hasPdfLink) completeness.missing.push("pdfLink");
  if (!completeness.hasDocumentDate) completeness.missing.push("documentDate");
  if (!completeness.hasPage) completeness.missing.push("page");
  if (!completeness.hasBbox) completeness.missing.push("bbox");

  return completeness;
}

function buildEvidence(input: {
  props: Record<string, unknown>;
  sourceRef: string | null;
}): SignalEvidence {
  const { props, sourceRef } = input;
  const properties = nestedProperties(props);
  const refs = extractEvidenceRefs(props);
  const firstRef = refs[0];
  const sourceRefString = readString(sourceRef);

  const sourceUrl = firstEvidenceString([
    firstRef?.sourceUrl,
    firstRef?.documentUrl,
    props.sourceUrl,
    properties.sourceUrl,
    props.url,
    properties.url,
    isUrlLike(sourceRefString) ? sourceRefString : null,
  ]);
  const documentUrl = firstEvidenceString([
    firstRef?.documentUrl,
    sourceUrl,
    props.documentUrl,
    properties.documentUrl,
  ]);
  const rawRef = firstEvidenceString([
    firstRef?.rawRef,
    props.rawRef,
    properties.rawRef,
    !isUrlLike(sourceRefString) ? sourceRefString : null,
  ]);

  const evidenceWithoutCompleteness: Omit<SignalEvidence, "completeness"> = {
    description: firstEvidenceString([
      props.description,
      properties.description,
      props.summary,
      properties.summary,
      props.resume,
      properties.resume,
      props.justification,
      properties.justification,
    ]),
    citation: firstEvidenceString([
      firstRef?.citation,
      firstRef?.excerpt,
      props.citation,
      properties.citation,
      props.excerpt,
      properties.excerpt,
    ]),
    excerpt: firstEvidenceString([
      firstRef?.excerpt,
      firstRef?.citation,
      props.excerpt,
      properties.excerpt,
      props.citation,
      properties.citation,
    ]),
    sourceUrl,
    documentUrl,
    rawRef,
    rawObjectKey: firstEvidenceString([
      firstRef?.rawObjectKey,
      props.rawObjectKey,
      properties.rawObjectKey,
      props.storageKey,
      properties.storageKey,
      props.casKey,
      properties.casKey,
    ]),
    sourceRef: sourceRefString,
    documentDate: firstEvidenceString([
      props.documentDate,
      properties.documentDate,
      props.date,
      properties.date,
      props.publishedAt,
      properties.publishedAt,
      props.meetingDate,
      properties.meetingDate,
      props.etapeDate,
      properties.etapeDate,
      props.etape_date,
      properties.etape_date,
    ]),
    page: firstEvidenceNumber([firstRef?.page, props.page, properties.page]),
    bbox: firstEvidenceBbox([firstRef?.bbox, props.bbox, properties.bbox]),
    refs,
  };

  return {
    ...evidenceWithoutCompleteness,
    completeness: buildCompleteness(evidenceWithoutCompleteness),
  };
}

function evidenceRefFromDocRef(ref: GraphSignalDocRef): SignalEvidenceRef {
  return {
    docSha: ref.docSha,
    citation: ref.excerpt ?? null,
    excerpt: ref.excerpt ?? null,
    sourceUrl: ref.sourceUrl ?? null,
    documentUrl: ref.documentUrl ?? ref.sourceUrl ?? null,
    rawRef: ref.rawRef ?? null,
    rawObjectKey: null,
    page: ref.page ?? null,
    bbox: readBbox(ref.bbox),
  };
}

function mergeEvidenceWithDocRefs(
  evidence: SignalEvidence,
  docRefs: readonly GraphSignalDocRef[],
  firstPublishedAt: string | null,
): SignalEvidence {
  const firstRef = docRefs[0];
  const refs = evidence.refs.length > 0 ? evidence.refs : docRefs.map(evidenceRefFromDocRef);
  const merged: Omit<SignalEvidence, "completeness"> = {
    ...evidence,
    citation: evidence.citation ?? firstRef?.excerpt ?? null,
    excerpt: evidence.excerpt ?? firstRef?.excerpt ?? null,
    sourceUrl: evidence.sourceUrl ?? firstRef?.sourceUrl ?? null,
    documentUrl: evidence.documentUrl ?? firstRef?.documentUrl ?? firstRef?.sourceUrl ?? null,
    rawRef: firstRef?.rawRef ?? evidence.rawRef ?? null,
    documentDate: evidence.documentDate ?? firstRef?.publishedAt ?? firstPublishedAt,
    page: evidence.page ?? firstRef?.page ?? null,
    bbox: evidence.bbox ?? readBbox(firstRef?.bbox),
    refs,
  };
  return {
    ...merged,
    completeness: buildCompleteness(merged),
  };
}

export function graphSignalsRoute(deps: GraphSignalsDeps): Hono {
  const app = new Hono();

  // GET /api/graph-signals/by-city
  app.get("/api/graph-signals/by-city", async (c) => {
    const cities = await listCitiesWithSignalNodes(deps.db);
    const totalCount = cities.reduce((sum, city) => sum + city.signalCount, 0);
    return c.json({ ok: true, totalCount, cities });
  });

  // GET /api/graph-signals/:city
  app.get("/api/graph-signals/:city", async (c) => {
    const city = c.req.param("city");
    const nodes = await getSignalNodesForCity(deps.db, city);
    if (nodes.length === 0) {
      return c.json({ ok: false, error: "no_signal_nodes", citySlug: city }, 404);
    }
    const mapped = await Promise.all(nodes.map((n) => toGraphSignalCard(deps.store, n)));
    return c.json({ ok: true, citySlug: city, nodes: mapped });
  });

  return app;
}
