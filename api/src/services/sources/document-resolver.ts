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
  return (
    rawRef.startsWith(RAW_PREFIX) &&
    !rawRef.endsWith(META_SUFFIX) &&
    !rawRef.includes("..") &&
    !rawRef.includes("\0")
  );
}

export function apiDocumentUrl(rawRef: string): string {
  return `/api/documents/raw?rawRef=${encodeURIComponent(rawRef)}`;
}

export async function loadDocumentMetadata(
  store: ObjectStore,
  rawRef: string,
): Promise<DocumentMetadata | null> {
  if (!isSafeRawRef(rawRef)) return null;

  const head = await store.head(rawMetaKey(rawRef));
  if (!head) return null;

  const parsed = RawDocumentRecordSchema.safeParse(
    tryParseJson(await store.get(rawMetaKey(rawRef))),
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

export async function findDocumentMetadata(
  store: ObjectStore,
  params: { rawRef?: string; docSha?: string },
): Promise<DocumentMetadata | null> {
  if (params.rawRef) {
    const byRawRef = await loadDocumentMetadata(store, params.rawRef);
    if (byRawRef) return byRawRef;
  }

  if (!params.docSha || !store.list) return null;

  const metaKeys = (await store.list(RAW_PREFIX))
    .filter((key) => key.endsWith(META_SUFFIX))
    .sort();
  for (const metaKey of metaKeys) {
    const parsed = RawDocumentRecordSchema.safeParse(tryParseJson(await store.get(metaKey)));
    if (!parsed.success) continue;
    if (parsed.data.sha256 !== params.docSha) continue;
    return {
      rawRef: parsed.data.storageKey,
      docSha: parsed.data.sha256,
      sourceUrl: parsed.data.sourceUrl,
      contentType: parsed.data.contentType,
      fetchedAt: parsed.data.fetchedAt,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.publishedAt !== undefined
        ? { publishedAt: parsed.data.publishedAt }
        : {}),
    };
  }

  return null;
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

