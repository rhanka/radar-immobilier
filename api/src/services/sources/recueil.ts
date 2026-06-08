import {
  buildRawDocumentRecord,
  SourceFetchError,
  type RawDocumentRecord,
  type SourceAdapter,
  type SourceErrorKind,
} from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";

/**
 * RECUEIL stage (SPEC_PLAN_SCRAPING §3.2): run a SourceAdapter, store the raw
 * bytes in object storage BEFORE any extraction, and emit a `RawDocumentRecord`
 * per fetched artifact. Idempotent: a byte-identical re-collection reuses the
 * same sha256-derived storage key (the `put` is skipped when the object already
 * exists). Never crashes — adapter failures become typed outcomes.
 */

export interface RecueilOptions {
  readonly limit?: number;
  /** CIBLAGE plan id propagated into provenance, when collection was scheduled. */
  readonly ciblagePlanId?: string;
  readonly signal?: AbortSignal;
}

export interface RecueilSuccess {
  readonly ok: true;
  readonly source: string;
  readonly count: number;
  readonly rawDocIds: readonly string[];
  readonly records: readonly RawDocumentRecord[];
  readonly fetchedAt: string;
}

export interface RecueilFailure {
  readonly ok: false;
  readonly source: string;
  readonly error: SourceErrorKind;
  readonly detail: string;
  readonly fetchedAt: string;
}

export type RecueilOutcome = RecueilSuccess | RecueilFailure;

/**
 * Collect raw documents for one source via its adapter.
 *
 * @param source  Stable source id (e.g. "avis-publics-valleyfield").
 * @param adapter SourceAdapter implementing the J0 contract.
 * @param store   Object storage boundary (S3/MinIO).
 */
export async function runRecueil(
  source: string,
  adapter: SourceAdapter,
  store: ObjectStore,
  options: RecueilOptions = {},
): Promise<RecueilOutcome> {
  const fetchedAt = new Date().toISOString();
  const records: RawDocumentRecord[] = [];
  const limit = options.limit ?? Number.POSITIVE_INFINITY;

  try {
    let processed = 0;
    const listOpts = {
      ...(adapter.city !== undefined ? { city: adapter.city } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    };
    for await (const ref of adapter.list(listOpts)) {
      if (processed >= limit) break;
      if (options.signal?.aborted) break;

      const raw = await adapter.fetch(ref);

      const record = buildRawDocumentRecord({
        source,
        sourceUrl: raw.url,
        body: raw.body,
        fetchedAt: raw.fetchedAt,
        contentType: raw.contentType,
        provenance: {
          ...(options.ciblagePlanId !== undefined
            ? { ciblagePlanId: options.ciblagePlanId }
            : {}),
          version: raw.provenance.adapterVersion,
          userAgent: raw.provenance.userAgent ?? "unknown",
          viaObscura: raw.provenance.fetchedViaObscura,
        },
      });

      // Idempotent store: write the raw bytes only if the object is absent.
      const existing = await store.head(record.storageKey);
      if (!existing) {
        await store.put(record.storageKey, raw.body, record.contentType);
      }

      records.push(record);
      processed += 1;
    }
  } catch (e) {
    if (e instanceof SourceFetchError) {
      return { ok: false, source, error: e.kind, detail: e.detail, fetchedAt };
    }
    // Storage / unexpected failure — surface as a typed network-class error
    // rather than crashing the request.
    return {
      ok: false,
      source,
      error: "network",
      detail: e instanceof Error ? e.message : String(e),
      fetchedAt,
    };
  }

  return {
    ok: true,
    source,
    count: records.length,
    rawDocIds: records.map((r) => r.id),
    records,
    fetchedAt,
  };
}
