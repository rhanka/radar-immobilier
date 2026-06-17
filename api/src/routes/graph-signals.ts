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
import { getSignalNodesForCity, listCitiesWithSignalNodes } from "../services/graph/graph-store.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import {
  apiDocumentUrl,
  findDocumentMetadata,
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
    return ref.rawRef && !ref.sourceUrl
      ? { ...ref, documentUrl: apiDocumentUrl(ref.rawRef) }
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
    props,
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
