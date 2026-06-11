import {
  buildRawDocumentRecord,
  rawMetaKey,
  SourceFetchError,
  type RawDocumentRecord,
  type SourceAdapter,
  type SourceErrorKind,
} from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";
import {
  manifestKey,
  writeRunManifest,
  type RunManifestEntry,
} from "./run-manifest.js";

/**
 * RECUEIL stage (SPEC_PLAN_SCRAPING §3.2): run a SourceAdapter, store the raw
 * bytes in object storage BEFORE any extraction, and emit a `RawDocumentRecord`
 * per fetched artifact. Idempotent: a byte-identical re-collection reuses the
 * same sha256-derived storage key (the `put` is skipped when the object already
 * exists). Never crashes — adapter failures become typed outcomes.
 */

export interface RecueilOptions {
  readonly limit?: number;
  /**
   * CIBLAGE plan id propagated into provenance, when collection was scheduled.
   * References a `CiblagePlan.id` (pipeline stage 1, `@radar/domain`): the
   * editable plan that DECLARED this collection. The recueil executor (next lot)
   * passes the enabled plan's id here so every collected RawDocument traces back
   * to the targeting decision. Stage 1 (ciblage) writes the plan; this is the
   * read of that plan's id at recueil time.
   */
  readonly ciblagePlanId?: string;
  readonly signal?: AbortSignal;
  /**
   * Run id, used to namespace the run manifest under `runs/{source}/{runId}/`.
   * Optional — defaults to a value derived from `fetchedAt`
   * (`${fetchedAt.replace(/[:.]/g, "")}-r`). Only consumed by
   * `runRecueilWithManifest`; `runRecueil` itself ignores it.
   */
  readonly runId?: string;
}

export interface RecueilSuccess {
  readonly ok: true;
  readonly source: string;
  readonly count: number;
  readonly rawDocIds: readonly string[];
  readonly records: readonly RawDocumentRecord[];
  readonly fetchedAt: string;
  /**
   * One manifest entry per doc seen this run, in collection order, each
   * carrying the dedup decision (`new` = bytes PUT, `seen` = HEAD-skip). The
   * commit record (`runs/{source}/{runId}/manifest.jsonl`) is built from this;
   * `runRecueilWithManifest` writes it, `runRecueil` only computes it.
   */
  readonly manifestEntries: readonly RunManifestEntry[];
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
  const manifestEntries: RunManifestEntry[] = [];
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
      // The HEAD result is the dedup decision recorded in the run manifest:
      // absent ⇒ "new" (we PUT), present ⇒ "seen" (byte-identical, HEAD-skip).
      const existing = await store.head(record.storageKey);
      const status: RunManifestEntry["status"] = existing ? "seen" : "new";
      if (!existing) {
        await store.put(record.storageKey, raw.body, record.contentType);
      }

      // Sidecar meta.json (RawDocumentRecord) so each CAS object is
      // self-describing on S3 (url, fetchedAt, provenance, sha256).
      const metaKey = rawMetaKey(record.storageKey);
      if (!(await store.head(metaKey))) {
        await store.put(
          metaKey,
          JSON.stringify(record, null, 2),
          "application/json",
        );
      }

      records.push(record);
      manifestEntries.push({
        sha256: record.sha256,
        sourceUrl: record.sourceUrl,
        casKey: record.storageKey,
        status,
        ...(ref.publishedAt !== undefined
          ? { publishedAt: ref.publishedAt }
          : {}),
      });
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
    manifestEntries,
  };
}

/**
 * Default run id derived from a fetch timestamp (SPEC §5): the ISO instant with
 * `:` and `.` stripped, suffixed `-r`, e.g. `2026-06-08T09:30:00.000Z` →
 * `2026-06-08T093000000Z-r`. Used when the caller does not pass `runId`.
 */
function defaultRunId(fetchedAt: string): string {
  return `${fetchedAt.replace(/[:.]/g, "")}-r`;
}

/**
 * Like {@link runRecueil}, but on a SUCCESSFUL run also writes the run manifest
 * `runs/{source}/{runId}/manifest.jsonl` (SPEC_PERSISTENCE_S3_FIRST §1.1, §5) —
 * one JSONL line per doc seen, with the `new`/`seen` dedup status. The manifest
 * is written LAST (after every CAS object + sidecar), so its presence attests
 * that everything it references already exists. On failure, no manifest is
 * written (a partial run is not committed).
 *
 * `runId` is taken from `options.runId`, else derived from `fetchedAt`.
 */
export async function runRecueilWithManifest(
  source: string,
  adapter: SourceAdapter,
  store: ObjectStore,
  options: RecueilOptions = {},
): Promise<RecueilOutcome> {
  const outcome = await runRecueil(source, adapter, store, options);
  if (!outcome.ok) return outcome;

  const runId = options.runId ?? defaultRunId(outcome.fetchedAt);
  await writeRunManifest(store, {
    source,
    runId,
    entries: outcome.manifestEntries,
  });
  return outcome;
}

export { manifestKey };
