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

const SHA256_RE = /^[0-9a-f]{64}$/i;

/**
 * Resolve a bare docSha (sha256) to its canonical CAS rawRef.
 *
 * Strategy, cheapest-first:
 *   1. `findDocumentMetadata({ docSha })` — works when sibling `.meta.json`
 *      files exist (scans them and matches `sha256`).
 *   2. Fallback CAS scan — lists `raw/` and matches `…/cas/<docSha>.<ext>`.
 *      Required for sources stored without `.meta.json` siblings (e.g.
 *      `raw/proces-verbaux-rimouski/cas/<sha>.pdf`), where strategy 1 finds
 *      nothing.
 *
 * Returns the normalized rawRef, or `null` when the docSha is malformed or no
 * matching CAS object exists.
 */
export async function resolveDocShaToRawRef(
  store: ObjectStore,
  docSha: string,
): Promise<string | null> {
  const sha = docSha.trim().toLowerCase();
  if (!SHA256_RE.test(sha)) return null;

  // 1. Metadata-backed resolution (when .meta.json siblings exist).
  const meta = await findDocumentMetadata(store, { docSha: sha });
  if (meta?.rawRef) {
    const normalized = normalizeRawRef(meta.rawRef);
    if (normalized) return normalized;
  }

  // 2. CAS fallback: scan raw/ for …/cas/<sha>.<ext> (no .meta.json needed).
  if (!store.list) return null;
  const needle = `/cas/${sha}.`;
  const match = (await store.list(RAW_PREFIX)).find(
    (key) => key.includes(needle) && !key.endsWith(META_SUFFIX),
  );
  return match ? normalizeRawRef(match) : null;
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
