import {
  buildRawDocumentRecord,
  rawMetaKey,
  SourceFetchError,
  PvSourceFetchError,
  type PvFetchDiagnostic,
  type RawDocumentRecord,
  type RawDocumentRef,
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
 *
 * TWO PHASES, TWO CONSEQUENCES (issue #723). Listing and fetching used to sit
 * inside ONE `try`, so the first error of either kind aborted the source and
 * the caller then reported `docs=0`. On drummondville that meant: 252 documents
 * downloaded and written to the CAS, the 253ʳᵈ a dead 2016 link returning 404,
 * and the whole city reported as collecting nothing — deterministically, every
 * night, with no way to tell from the log which of the 255 URLs had failed.
 *
 *   - LISTING failure (the index page, the sitemap): nothing can be enumerated,
 *     so the source fails — `ok: false`. If it happens AFTER some documents
 *     were already collected, what was collected is KEPT and the outcome is a
 *     truncated success (`listingTruncatedBy`), never a discard.
 *   - DOCUMENT failure: counted in `documentFailures` with its URL, phase and
 *     status, and the run CONTINUES to the next reference.
 *   - ZERO documents collected AND at least one failure: the source failed —
 *     `ok: false`. "Nothing collected, everything tried failed" is not a
 *     success with holes. Single-reference sources (the avis-publics adapters,
 *     whose one document IS the index page) are entirely this case.
 */

export interface RecueilOptions {
  readonly limit?: number;
  /** Skip listed representations before they count toward `limit` or get fetched. */
  readonly acceptRef?: (ref: RawDocumentRef) => boolean;
  /** Optional source-specific pacing hook, invoked immediately before each fetch. */
  readonly beforeFetch?: (ref: RawDocumentRef) => Promise<void>;
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

/**
 * One reference that could not be collected, kept as data instead of aborting
 * the source. Carries what the log needs to be actionable at a glance: the
 * exact URL, the phase, the typed kind and the HTTP status when there was one.
 */
export interface RecueilFetchFailure {
  /** Exact URL that failed. */
  readonly url: string;
  /** `document` for a PV, `index` for the index page / sitemap / session page. */
  readonly phase: "index" | "document";
  /** Typed failure kind (`http`, `timeout`, `network`, `parse`, `storage`). */
  readonly error: SourceErrorKind | "storage";
  /** Verbatim detail (`HTTP 404`, the timeout message…). */
  readonly detail: string;
  /** HTTP status when the failure was an HTTP response; `null` otherwise. */
  readonly httpStatus: number | null;
}

export interface RecueilSuccess {
  readonly ok: true;
  readonly source: string;
  /** Number of documents newly written to the raw CAS in this run. */
  readonly newDocuments: number;
  /** Number of documents whose raw CAS object was already present. */
  readonly skippedExisting: number;
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
  /**
   * References that failed during this run WITHOUT costing the source. Empty on
   * a clean run. A non-empty array is a successful run with holes, not a
   * failure: `count`, `records` and `manifestEntries` describe what WAS
   * collected and are never zeroed because of these.
   */
  readonly documentFailures: readonly RecueilFetchFailure[];
  /**
   * Set when ENUMERATION stopped early (the index page, the sitemap or the
   * generator itself failed) after at least one document had been collected.
   * The harvest is kept and committed; this says the list may be incomplete, so
   * the next run will pick up what is missing. Absent on a complete run.
   */
  readonly listingTruncatedBy?: RecueilFetchFailure;
}

export interface RecueilFailure {
  readonly fetchFailure?: PvFetchDiagnostic;
  readonly ok: false;
  readonly source: string;
  readonly error: SourceErrorKind;
  readonly detail: string;
  readonly fetchedAt: string;
}

export type RecueilOutcome = RecueilSuccess | RecueilFailure;

export interface RecueilMetrics {
  readonly index404: number;
  readonly document404: number;
  readonly newDocuments: number;
  readonly skippedExisting: number;
  /** Zero only when the final listed reference was reached; otherwise unknown. */
  readonly remaining: number | null;
}

let metrics: RecueilMetrics = { newDocuments: 0, skippedExisting: 0, remaining: 0, index404: 0, document404: 0 };

/** Reset the process-local worker counters before a live scrape run. */
export function resetRecueilMetrics(): void {
  metrics = { newDocuments: 0, skippedExisting: 0, remaining: 0, index404: 0, document404: 0 };
}

/** Return the process-local counters accumulated by completed RECUEIL calls. */
export function recueilMetrics(): RecueilMetrics {
  return metrics;
}

/** Machine-readable terminal summary emitted by worker-live. */
export function recueilMetricsJson(): string {
  return JSON.stringify(metrics);
}

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
  // The live worker uses this cap to bound the memory-intensive new writes.
  // Existing CAS objects do not consume it, so deterministic retries advance.
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  let newDocuments = 0;
  let skippedExisting = 0;

  const documentFailures: RecueilFetchFailure[] = [];
  let listingTruncatedBy: RecueilFetchFailure | undefined;
  // Kept so a run that collected NOTHING can still report the typed error that
  // caused it, exactly as before (see the zero-harvest rule below).
  let firstDocumentError: unknown;

  const listOpts = {
    ...(adapter.city !== undefined ? { city: adapter.city } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  // The iterator is driven BY HAND rather than with `for await`, because the
  // two phases must be caught separately: an error out of `iterator.next()` is
  // the LISTING failing, an error inside the body is ONE DOCUMENT failing. A
  // `for await` puts both under the same `catch` — which is exactly the defect
  // of issue #723.
  const iterator = adapter.list(listOpts)[Symbol.asyncIterator]();

  for (;;) {
    let step: IteratorResult<RawDocumentRef>;
    try {
      step = await iterator.next();
    } catch (e) {
      const failure = toFetchFailure(e, "index");
      countHttp404(failure);
      // Nothing collected yet ⇒ the source genuinely failed (index / sitemap
      // unreachable): the city is lost, and THAT is the only case where it is.
      if (records.length === 0) return failureOutcome(e, source, fetchedAt);
      // Something WAS collected: keep it, commit it, and record that the list
      // is incomplete. The next run re-reads the index and picks up the rest.
      listingTruncatedBy = failure;
      break;
    }
    if (step.done) break;
    const ref = step.value;

    if (newDocuments >= limit) {
      metrics = { ...metrics, remaining: null };
      break;
    }
    if (options.signal?.aborted) break;
    if (options.acceptRef && !options.acceptRef(ref)) continue;

    try {
      await options.beforeFetch?.(ref);
      if (options.signal?.aborted) break;
      const raw = await adapter.fetch(ref);

      const record = buildRawDocumentRecord({
        source,
        sourceUrl: raw.url,
        ...(raw.ref.title !== undefined ? { title: raw.ref.title } : {}),
        ...(raw.ref.publishedAt !== undefined ? { publishedAt: raw.ref.publishedAt } : {}),
        body: raw.body,
        ...(raw.text !== undefined ? { text: raw.text } : {}),
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
        newDocuments += 1;
        metrics = { ...metrics, newDocuments: metrics.newDocuments + 1 };
      } else {
        skippedExisting += 1;
        metrics = { ...metrics, skippedExisting: metrics.skippedExisting + 1 };
      }

      // Persist the parseable text (pdftotext) BESIDE the binary body so
      // EXPLOITATION reconciles on real text — the binary stays the canonical,
      // openable evidence (classify:13-17 / RawDocument.text intent). Gated on the
      // TEXTKEY's OWN head-check (not the binary's `existing`): a re-run whose
      // binary already exists (content-dedup) must still BACK-FILL the text when
      // it is missing — otherwise `record.textKey` is set but the object is absent
      // and EXPLOITATION reads a void. Idempotent.
      if (
        record.textKey !== undefined &&
        raw.text !== undefined &&
        !(await store.head(record.textKey))
      ) {
        await store.put(record.textKey, raw.text, "text/plain; charset=utf-8");
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
        ...(record.publishedAt !== undefined
          ? { publishedAt: record.publishedAt }
          : {}),
      });
    } catch (e) {
      // ONE document failed — counted, journalled with its URL and its phase,
      // and the run goes on. Nothing already written to the CAS is discarded.
      const failure = toFetchFailure(e, "document", ref.url);
      countHttp404(failure);
      documentFailures.push(failure);
      if (firstDocumentError === undefined) firstDocumentError = e;
      continue;
    }
  }

  // ZERO HARVEST + AT LEAST ONE FAILURE ⇒ the source FAILED. "Collected nothing
  // and everything we tried failed" is not a success with holes; it is what
  // `POST /api/sources/collect/:source` answers 502 to, and what makes a
  // pipeline run PARTIAL. Sources whose `list()` yields a single reference (the
  // avis-publics adapters, whose document IS the index page) live entirely in
  // this case. The #723 fix is unaffected: a run that collected 252 of 255
  // documents has a harvest and stays a success.
  if (records.length === 0 && documentFailures.length > 0) {
    return failureOutcome(firstDocumentError, source, fetchedAt);
  }

  return {
    ok: true,
    source,
    newDocuments,
    skippedExisting,
    count: records.length,
    rawDocIds: records.map((r) => r.id),
    records,
    fetchedAt,
    manifestEntries,
    documentFailures,
    ...(listingTruncatedBy !== undefined ? { listingTruncatedBy } : {}),
  };
}

/**
 * Normalise anything thrown during collection into a `RecueilFetchFailure`.
 * The PHASE carried by a `PvSourceFetchError` wins over the caller's guess: the
 * adapter is the only layer that knows whether the URL it was on was an index
 * page or a document.
 */
function toFetchFailure(
  e: unknown,
  fallbackPhase: "index" | "document",
  fallbackUrl = "",
): RecueilFetchFailure {
  if (e instanceof PvSourceFetchError) {
    return {
      url: e.url,
      phase: e.phase,
      error: e.kind,
      detail: e.detail,
      httpStatus: e.httpStatus,
    };
  }
  if (e instanceof SourceFetchError) {
    return {
      url: fallbackUrl,
      phase: fallbackPhase,
      error: e.kind,
      detail: e.detail,
      httpStatus: null,
    };
  }
  // Storage / unexpected failure — typed as `storage` so it is never confused
  // with a source being unreachable.
  return {
    url: fallbackUrl,
    phase: fallbackPhase,
    error: "storage",
    detail: e instanceof Error ? e.message : String(e),
    httpStatus: null,
  };
}

/** Keep the index404 / document404 split of the per-run counters. */
function countHttp404(failure: RecueilFetchFailure): void {
  if (failure.httpStatus !== 404) return;
  const counter = failure.phase === "index" ? "index404" : "document404";
  metrics = { ...metrics, [counter]: metrics[counter] + 1 };
}

/** Build the `ok: false` outcome for a source that could collect nothing. */
function failureOutcome(
  e: unknown,
  source: string,
  fetchedAt: string,
): RecueilFailure {
  if (e instanceof PvSourceFetchError) {
    const { url, phase, httpStatus, headers, durationMs } = e;
    return {
      ok: false, source, error: e.kind, detail: e.detail, fetchedAt,
      fetchFailure: { url, phase, httpStatus, headers, durationMs },
    };
  }
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
 * that everything it references already exists. On failure (`ok: false`, i.e.
 * nothing at all could be collected) no manifest is written.
 *
 * A run WITH HOLES is not a failure and IS committed: documents that failed are
 * listed in `documentFailures` and simply absent from the manifest, so the next
 * run retries exactly them. Before issue #723's fix, one failed document made
 * the whole run `ok: false` — the CAS objects and sidecars of the documents
 * already collected stayed on S3 with no manifest referencing them, so the run
 * never terminated and the bytes were orphaned.
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
