import { DocumentDateSchema, RawDocumentRecordSchema, rawMetaKey, resolveDocumentDate,
  type DocumentDate, type RawDocumentRecord } from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";

export function applyDocumentDate(record: RawDocumentRecord, date: DocumentDate): RawDocumentRecord {
  const updated = { ...record, documentDate: date };
  delete updated.publishedAt;
  if (date.status === "known") updated.publishedAt = date.value;
  return RawDocumentRecordSchema.parse(updated);
}

/** Enrich only missing metadata; preserve source identity and the first fetchedAt. */
export async function persistDocumentDate(store: ObjectStore, rawRef: string, candidate: DocumentDate,
  collected?: RawDocumentRecord): Promise<RawDocumentRecord | null> {
  const key = rawMetaKey(rawRef);
  const exists = await store.head(key);
  const original = exists ? RawDocumentRecordSchema.safeParse(JSON.parse(new TextDecoder()
    .decode(await store.get(key)))) : null;
  if (original && !original.success) throw new Error(`Invalid documentary metadata for ${rawRef}`);
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
