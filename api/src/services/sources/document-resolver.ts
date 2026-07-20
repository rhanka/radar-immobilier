import { RawDocumentRecordSchema, rawMetaKey } from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";

const RAW_PREFIX = "raw/";
const META_SUFFIX = ".meta.json";

export interface DocumentMetadata {
  readonly rawRef: string;
  readonly docSha: string;
  readonly sourceUrl: string;
  readonly contentType: string;
  readonly fetchedAt: string;
  readonly title?: string;
  readonly publishedAt?: string;
}

const decoder = new TextDecoder();

function tryParseJson(bytes: Uint8Array): unknown | null {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
}

export function isSafeRawRef(rawRef: string): boolean {
  return normalizeRawRef(rawRef) !== null;
}

export function normalizeRawRef(rawRef: string): string | null {
  const trimmed = rawRef.trim();
  const rawIndex = trimmed.indexOf(RAW_PREFIX);
  const normalized = rawIndex >= 0 ? trimmed.slice(rawIndex) : trimmed;
  return (
    normalized.startsWith(RAW_PREFIX) &&
    !normalized.endsWith(META_SUFFIX) &&
    !normalized.includes("..") &&
    !normalized.includes("\0")
  )
    ? normalized
    : null;
}

export function apiDocumentUrl(rawRef: string): string {
  return `/api/documents/raw?rawRef=${encodeURIComponent(normalizeRawRef(rawRef) ?? rawRef)}`;
}

export async function loadDocumentMetadata(
  store: ObjectStore,
  rawRef: string,
): Promise<DocumentMetadata | null> {
  const normalizedRawRef = normalizeRawRef(rawRef);
  if (!normalizedRawRef) return null;

  const head = await store.head(rawMetaKey(normalizedRawRef));
  if (!head) return null;

  const parsed = RawDocumentRecordSchema.safeParse(
    tryParseJson(await store.get(rawMetaKey(normalizedRawRef))),
  );
  if (!parsed.success) return null;

  const record = parsed.data;
  return {
    rawRef: record.storageKey,
    docSha: record.sha256,
    sourceUrl: record.sourceUrl,
    contentType: record.contentType,
    fetchedAt: record.fetchedAt,
    ...(record.title !== undefined ? { title: record.title } : {}),
    ...(record.publishedAt !== undefined ? { publishedAt: record.publishedAt } : {}),
  };
}

/**
 * Resolves a document's metadata by rawRef ONLY — direct `.meta.json` lookup,
 * O(1) object-store calls, no bucket scan.
 *
 * INCIDENT "signal API never responds": the former docSha fallback listed the
 * whole bucket (`store.list("raw/")`, ~20k keys) then GET'ed every
 * `.meta.json` sequentially (~50 min) as soon as ONE rawRef was missing its
 * `.meta.json` in S3. Launched per node by the per-city route, the endpoint
 * never answered. The fallback is REMOVED: a missing meta now degrades to
 * `null` (the ref is served without document metadata, the endpoint always
 * responds). Any future docSha lookup MUST be strictly bounded (time budget
 * or iteration cap) — never an unbounded full scan.
 *
 * `params.docSha` is kept in the signature for call-site compatibility but is
 * deliberately NOT used as a lookup key anymore.
 */
export async function findDocumentMetadata(
  store: ObjectStore,
  params: { rawRef?: string; docSha?: string },
): Promise<DocumentMetadata | null> {
  if (!params.rawRef) return null;
  return loadDocumentMetadata(store, params.rawRef);
}

export async function resolveRawContentType(
  store: ObjectStore,
  rawRef: string,
): Promise<string> {
  const head = await store.head(rawRef);
  if (head?.contentType) return head.contentType;
  const meta = await loadDocumentMetadata(store, rawRef);
  return meta?.contentType ?? "application/octet-stream";
}
