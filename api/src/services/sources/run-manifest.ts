import type { ObjectStore } from "../../storage/object-store.js";

/**
 * RUN MANIFEST (SPEC_PERSISTENCE_S3_FIRST §1.1, §5) — the commit record of one
 * collection run and the transaction-time axis of the bitemporal model. Written
 * LAST in a run as `runs/{source}/{runId}/manifest.jsonl`: **one JSON object per
 * doc seen** (JSONL — one object per line, NOT a JSON array). Because it is
 * written after the CAS bytes + sidecar, "manifest present ⇒ everything it
 * references already exists" — the manifest is the index that makes a hot-path
 * S3 LIST unnecessary.
 *
 * `status` records the dedup decision: `"new"` when the raw bytes were actually
 * PUT this run, `"seen"` when a byte-identical object already existed (HEAD-skip).
 */
export interface RunManifestEntry {
  /** SHA-256 hex digest of the raw bytes (idempotency key). */
  readonly sha256: string;
  /** Exact URL the bytes were fetched from. */
  readonly sourceUrl: string;
  /** CAS object key under which the raw bytes live (`RawDocumentRecord.storageKey`). */
  readonly casKey: string;
  /** Dedup decision: `new` = bytes PUT this run, `seen` = HEAD-skipped. */
  readonly status: "new" | "seen";
  /**
   * Valid-time anchor (date of the act/session) when the source exposes it.
   * Optional — omitted (never null) when the adapter has no published date.
   */
  readonly publishedAt?: string;
}

/**
 * Object-storage key for a run manifest:
 *   runs/{source}/{runId}/manifest.jsonl
 */
export function manifestKey(source: string, runId: string): string {
  return `runs/${source}/${runId}/manifest.jsonl`;
}

/**
 * Serialize one manifest entry to a single JSONL line. Optional fields are
 * omitted rather than emitted as `null` so the line stays minimal and the
 * "field absent" semantics is unambiguous.
 */
function serializeEntry(entry: RunManifestEntry): string {
  const obj: Record<string, unknown> = {
    sha256: entry.sha256,
    sourceUrl: entry.sourceUrl,
    casKey: entry.casKey,
    status: entry.status,
  };
  if (entry.publishedAt !== undefined) {
    obj.publishedAt = entry.publishedAt;
  }
  return JSON.stringify(obj);
}

/**
 * Write the run manifest as JSONL under `runs/{source}/{runId}/manifest.jsonl`.
 * One line per entry, trailing newline so the file is append-friendly. Returns
 * the key it wrote to.
 */
export async function writeRunManifest(
  store: ObjectStore,
  params: {
    source: string;
    runId: string;
    entries: readonly RunManifestEntry[];
  },
): Promise<string> {
  const { source, runId, entries } = params;
  const key = manifestKey(source, runId);
  const body =
    entries.map(serializeEntry).join("\n") + (entries.length > 0 ? "\n" : "");
  await store.put(key, body, "application/x-ndjson");
  return key;
}
