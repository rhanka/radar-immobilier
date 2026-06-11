/**
 * WORKER LIVE — orchestration entry point that SCRAPES the config-only PV cities
 * live and writes their raw documents to the scraping object store (Scaleway in
 * production, MinIO locally). Spec: docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §3.
 *
 * For each `PvCityEntry.config` in `ALL_PV_CITIES` (or a requested subset) it
 * instantiates the generic PV adapter and runs the RECUEIL stage with a run
 * manifest (`runRecueilWithManifest`): CAS bytes + sidecar `.meta.json` + the
 * commit manifest `runs/{source}/{runId}/manifest.jsonl`.
 *
 * Idempotent — a byte-identical re-collection is HEAD-skipped by RECUEIL and
 * reported `seen`, writing no new CAS object. Never throws on a source failure:
 * an adapter fetch error becomes a per-city `status: "error"` recap entry.
 *
 * The `fetch` is injectable so the worker is unit-testable without real network
 * (the adapter accepts a `PvFetchLike`). In production, omit it and the adapter
 * falls back to `globalThis.fetch`.
 */

import {
  ALL_PV_CITIES,
  pdfToTextViaPoppler,
  ProcesVerbauxGenericAdapter,
  type PdfToText,
  type PvCityConfig,
  type PvFetchLike,
} from "@radar/sources";

import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import {
  exploitScrapedCity,
  type ExploitScrapeResult,
} from "./exploit-scrape.js";
import { runRecueilWithManifest } from "./recueil.js";

/** Per-city outcome of a live scrape run. */
export interface LiveScrapeCityRecap {
  /** City slug (e.g. "carignan"). */
  readonly city: string;
  /** Source id of the PV source (e.g. "proces-verbaux-carignan"). */
  readonly sourceId: string;
  /**
   * Aggregate status of the run for this city:
   *   - `new`   at least one doc had its bytes PUT this run,
   *   - `seen`  every collected doc was HEAD-skipped (byte-identical),
   *   - `error` the source failed (no manifest written, no docs committed).
   */
  readonly status: "new" | "seen" | "error";
  /** CAS object keys collected this run (empty on error). */
  readonly casKeys: readonly string[];
  /** Number of docs seen this run (0 on error). */
  readonly count: number;
  /** Error detail when `status === "error"` (omitted otherwise). */
  readonly error?: string;
  /**
   * EXPLOITATION recap, present only when `exploit: true` was requested AND the
   * RECUEIL succeeded. `signals` is the number of canonical DesignationEvents
   * (the real signals the Signaux view shows) projected into the per-city
   * project-state. `exploitError` is set (and `signals` 0) when exploitation
   * threw — never fatal: the scrape recap still reports the collected docs.
   */
  readonly signals?: number;
  /** EXPLOITATION error detail (non-fatal), when `exploit: true` and it threw. */
  readonly exploitError?: string;
}

export interface RunLiveScrapeOptions {
  /** Scraping object store (use `getScrapeObjectStore(config)` in production). */
  readonly store: ObjectStore;
  /** Injected fetch for the PV adapter (tests). Defaults to globalThis.fetch. */
  readonly fetch?: PvFetchLike;
  /** Per-city cap on the number of docs collected (RECUEIL `limit`). */
  readonly limit?: number;
  /** Look-back window in days passed to the adapter (defaults to 6 months). */
  readonly windowDays?: number;
  /** Clock injection for deterministic tests (run id + window). */
  readonly now?: () => Date;
  /** Abort signal threaded into RECUEIL. */
  readonly signal?: AbortSignal;
  /**
   * When true, run EXPLOITATION after each city's successful RECUEIL: PARSE the
   * freshly-collected raw PV (extract text → `parsed/…`) then project the real
   * DesignationEvents into `ontology/{city}/project-state.json` (the key the
   * Signaux view reads). OFF by default — a plain RECUEIL run writes only raw
   * PV. Exploitation is non-fatal: a failure is reported per-city, never aborts
   * the scrape. Spec: SPEC_PERSISTENCE_S3_FIRST §5 ([worker parse]).
   */
  readonly exploit?: boolean;
  /**
   * PDF→text extractor injected into EXPLOITATION (only used when `exploit`).
   * Defaults to `pdfToTextViaPoppler` (real poppler) in production; inject a mock
   * in tests. Absent poppler ⇒ a PDF yields empty text (0 signal, honest).
   */
  readonly pdfToText?: PdfToText;
  /**
   * Optional Drizzle DB handle propagated to EXPLOITATION's graph-feed (gated,
   * non-fatal). Only used when `exploit`.
   */
  readonly db?: Database;
}

/**
 * Resolve the set of `PvCityConfig` to scrape. When `citySlugs` is omitted, the
 * default is **all config-only cities** (those without a `pvText` fixture — the
 * ones the live worker is responsible for; golden demo cities are seeded
 * offline by pv-seed). When `citySlugs` is given, every requested slug must
 * exist in `ALL_PV_CITIES` or it is reported as an error (no silent drop).
 */
function resolveConfigs(
  citySlugs: readonly string[] | undefined,
): { configs: PvCityConfig[]; unknown: string[] } {
  if (citySlugs === undefined) {
    return {
      configs: ALL_PV_CITIES.filter((c) => !c.pvText).map((c) => c.config),
      unknown: [],
    };
  }
  const bySlug = new Map(ALL_PV_CITIES.map((c) => [c.config.citySlug, c.config]));
  const configs: PvCityConfig[] = [];
  const unknown: string[] = [];
  for (const slug of citySlugs) {
    const config = bySlug.get(slug);
    if (config) configs.push(config);
    else unknown.push(slug);
  }
  return { configs, unknown };
}

/**
 * Scrape the requested (or all config-only) PV cities live and write to `store`.
 *
 * @param citySlugs Optional subset of city slugs; omit for all config-only.
 * @param options   `{ store, fetch?, limit?, windowDays?, now?, signal?, exploit?, pdfToText?, db? }`.
 * @returns         One {@link LiveScrapeCityRecap} per city, in input order.
 */
export async function runLiveScrape(
  citySlugs: readonly string[] | undefined,
  options: RunLiveScrapeOptions,
): Promise<LiveScrapeCityRecap[]> {
  const { store, fetch, limit, windowDays, now, signal, exploit, db } = options;
  const { configs, unknown } = resolveConfigs(citySlugs);

  // Resolve the PDF→text extractor once (only used when `exploit`). Defaults to
  // real poppler; tests inject a mock. A scrape source URL is not meaningful here
  // (we extract from raw bytes), so a generic label is passed to the factory.
  const pdfToText: PdfToText | undefined = exploit
    ? (options.pdfToText ?? pdfToTextViaPoppler("live-scrape"))
    : undefined;

  const recap: LiveScrapeCityRecap[] = [];

  // Unknown slugs surface as honest errors rather than being silently dropped.
  for (const slug of unknown) {
    recap.push({
      city: slug,
      sourceId: "unknown",
      status: "error",
      casKeys: [],
      count: 0,
      error: `unknown city slug (not in ALL_PV_CITIES): ${slug}`,
    });
  }

  for (const config of configs) {
    if (signal?.aborted) {
      recap.push({
        city: config.citySlug,
        sourceId: config.sourceId,
        status: "error",
        casKeys: [],
        count: 0,
        error: "aborted",
      });
      continue;
    }

    const adapter = new ProcesVerbauxGenericAdapter(config, {
      ...(fetch !== undefined ? { fetchImpl: fetch } : {}),
      ...(windowDays !== undefined ? { windowDays } : {}),
      ...(now !== undefined ? { now } : {}),
    });

    const outcome = await runRecueilWithManifest(config.sourceId, adapter, store, {
      ...(limit !== undefined ? { limit } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });

    if (!outcome.ok) {
      recap.push({
        city: config.citySlug,
        sourceId: config.sourceId,
        status: "error",
        casKeys: [],
        count: 0,
        error: `[${outcome.error}] ${outcome.detail}`,
      });
      continue;
    }

    // Aggregate status: `new` if any doc's bytes were PUT this run, else `seen`.
    const anyNew = outcome.manifestEntries.some((e) => e.status === "new");

    // EXPLOITATION (opt-in): PARSE the freshly-collected raw PV + project the
    // real DesignationEvents into the per-city project-state (the Signaux key).
    // We reuse the in-hand `outcome.records` (never re-read/re-fetch). Non-fatal:
    // a failure is reported per-city but never aborts the scrape recap.
    let signals: number | undefined;
    let exploitError: string | undefined;
    if (exploit) {
      try {
        const result: ExploitScrapeResult = await exploitScrapedCity(
          store,
          config.citySlug,
          {
            records: outcome.records,
            ...(pdfToText !== undefined ? { pdfToText } : {}),
            ...(now !== undefined ? { now } : {}),
            ...(db !== undefined ? { db } : {}),
          },
        );
        signals = result.designationEventCount;
      } catch (e) {
        signals = 0;
        exploitError = e instanceof Error ? e.message : String(e);
      }
    }

    recap.push({
      city: config.citySlug,
      sourceId: config.sourceId,
      status: anyNew ? "new" : "seen",
      casKeys: outcome.manifestEntries.map((e) => e.casKey),
      count: outcome.count,
      ...(signals !== undefined ? { signals } : {}),
      ...(exploitError !== undefined ? { exploitError } : {}),
    });
  }

  return recap;
}
