/**
 * WORKER LIVE — orchestration entry point that SCRAPES the config-only PV cities
 * live and writes their raw documents to the scraping object store (OVH S3 in
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
 * A CITY IS LOST ONLY WHEN ITS INDEX IS (issue #723). A document that fails is
 * counted in `failedDocs`, journalled with its URL, and the city keeps the
 * documents it did collect. Requests are spaced by `minRequestIntervalMs`
 * (default: the Scraping Policy's 1 req / 2 s). With
 * `skipAlreadyCollectedUrls` — which `worker-live` sets for the 24 h cycle —
 * a document already collected is not downloaded again; the index itself is
 * read on every run, and that is the daily check for a new document.
 *
 * The `fetch` is injectable so the worker is unit-testable without real network
 * (the adapter accepts a `PvFetchLike`). In production, omit it and the adapter
 * falls back to `globalThis.fetch`.
 */

import {
  ALL_PV_CITIES,
  pdfToTextViaPoppler,
  ProcesVerbauxGenericAdapter,
  PV_MIN_REQUEST_INTERVAL_MS,
  type PdfToText,
  type PvCityConfig,
  type PvFetchLike,
  type PvFetchDiagnostic,
  type RawDocumentRecord,
  type RawDocumentRef,
} from "@radar/sources";

import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import {
  exploitScrapedCity,
  loadScrapedPvRecords,
  reexploitScrapedCityChunk,
  type ReexploitProgress,
  type ExploitScrapeResult,
} from "./exploit-scrape.js";
import { loadCollectedUrls, saveCollectedUrls } from "./known-urls.js";
import { runRecueilWithManifest, type RecueilFetchFailure } from "./recueil.js";

/**
 * Cap on the failed documents echoed back in a per-city recap. The full number
 * is always in `failedDocs`; this only bounds the detail carried in memory and
 * printed in a log line when a source breaks wholesale.
 */
export const MAX_REPORTED_DOCUMENT_FAILURES = 20;

/** Per-city outcome of a live scrape run. */
export interface LiveScrapeCityRecap {
  readonly fetchFailure?: PvFetchDiagnostic;
  /** City slug (e.g. "carignan"). */
  readonly city: string;
  /** Source id of the PV source (e.g. "proces-verbaux-carignan"). */
  readonly sourceId: string;
  /**
   * Aggregate status of the run for this city:
   *   - `new`   at least one doc had its bytes PUT this run,
   *   - `seen`  every collected doc was HEAD-skipped (byte-identical),
   *   - `error` the source failed (no manifest written, no docs committed).
   *
   * `error` now means what it says: NOTHING could be collected — the index page
   * or the sitemap was unreachable. A city whose index answered and whose
   * documents partly failed is `new`/`seen` with `failedDocs > 0`, not `error`
   * (issue #723: one dead document link used to report the whole city as
   * `docs=0`, which is how the investigation was sent after a phantom index
   * failure).
   */
  readonly status: "new" | "seen" | "error";
  /** CAS object keys collected this run (empty on error). */
  readonly casKeys: readonly string[];
  /** Number of docs seen this run (0 on error). */
  readonly count: number;
  /** Error detail when `status === "error"` (omitted otherwise). */
  readonly error?: string;
  /**
   * Number of documents that failed this run without costing the city. `0` (or
   * absent) on a clean run. `count` is unaffected: it reports what WAS
   * collected.
   */
  readonly failedDocs?: number;
  /**
   * Documents the run did NOT download because an earlier run already collected
   * them (`skipAlreadyCollectedUrls`). This is the differential made legible:
   * `count` is what was new tonight, `skippedKnown` is what was already in
   * storage, and `count: 0` with a non-zero `skippedKnown` is an up-to-date
   * city — the expected result of an update cycle, not a degradation.
   */
  readonly skippedKnown?: number;
  /**
   * The failed documents, with the exact URL, phase, kind and HTTP status of
   * each — capped at `MAX_REPORTED_DOCUMENT_FAILURES` so a systematically
   * broken source cannot flood the recap. `failedDocs` always carries the full
   * count.
   */
  readonly documentFailures?: readonly RecueilFetchFailure[];
  /**
   * Set when enumeration stopped early but what had been collected was kept and
   * committed. The list is incomplete; the next run re-reads the index.
   */
  readonly listingTruncatedBy?: RecueilFetchFailure;
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
  /** Durable parse progress for the process-restarting replay loop. */
  readonly reexploitProgress?: ReexploitProgress;
}

export interface RunLiveScrapeOptions {
  readonly onRequest?: (diagnostic: PvFetchDiagnostic & { city: string }) => void;
  /** Scraping object store (use `getScrapeObjectStore(config)` in production). */
  readonly store: ObjectStore;
  /**
   * Minimum spacing between two requests to the SAME city, in ms
   * (rules/MASTER.md §Scraping Policy: 1 req / 2 s per source). It covers the
   * index page as well as every document, because the adapter holds it.
   *
   * Default: `PV_MIN_REQUEST_INTERVAL_MS` on the real network, and `0` when a
   * `fetch` double is injected — a test double is not a municipal server, and
   * pacing it would only add 2 s per fetch to the suite. Pass an explicit value
   * to override either way; `0` disables the spacing.
   */
  readonly minRequestIntervalMs?: number;
  /**
   * Skip a listed document whose URL an EARLIER run already collected. The index
   * of every city is still read on every run — that IS the daily check for a new
   * document — but a document already in storage is not downloaded a second
   * time. This is the owner's « on ne rescrape pas tout chaque nuit ».
   *
   * The memory is CUMULATIVE (`runs/{source}/collected-urls.jsonl`, see
   * known-urls.ts): a run adds the URLs it collected and never removes any, so a
   * night with nothing new erases nothing. The first version of this guard read
   * the previous run's MANIFEST instead, which a quiet night leaves empty — the
   * regime then oscillated between 0 and N downloads. `live-scrape.test.ts`
   * plays four consecutive nights precisely to hold that down.
   *
   * A known URL costs NO request: it is skipped before `beforeFetch`, so there is
   * no GET and no HEAD. Nothing asks whether a stored document has been updated
   * — a published procès-verbal does not change (owner, 2026-09-20). The CAS
   * dedup by sha256 stays behind this, for the case of two URLs carrying the
   * same file; it cannot decide whether to download, because it only knows once
   * the bytes are already in hand.
   *
   * DEFAULT `false`, and BOTH callers turn it on: `worker-live` for the
   * on-demand mass scrape, and `acquireRefreshPdfManifest` for the daily
   * `radar-refresh-pv` cycle. The default stays off so an explicit caller — a
   * backfill, a repair — gets the whole window without having to think about it.
   *
   * It also changes how EXPLOITATION is fed: see `exploitationRecords` below.
   *
   * Composes with `acceptRef`: both must accept.
   */
  readonly skipAlreadyCollectedUrls?: boolean;
  /** Injected fetch for the PV adapter (tests). Defaults to globalThis.fetch. */
  readonly fetch?: PvFetchLike;
  /** Per-city collection cap; in replay mode, process-wide parse cap (default 25). */
  readonly limit?: number;
  /** Optional representation filter applied before the collection limit. */
  readonly acceptRef?: (ref: RawDocumentRef) => boolean;
  /** Optional pacing hook invoked immediately before each selected fetch. */
  readonly beforeFetch?: (ref: RawDocumentRef) => Promise<void>;
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
   * When true, run in REEXPLOIT mode: do NO network scrape at all. For each
   * requested city, reconstruct the stored `RawDocumentRecord`s from the object
   * store (the `*.meta.json` sidecars under `raw/proces-verbaux-<city>/cas/`) and
   * parse one bounded tranche via `reexploitScrapedCityChunk`. Once every PV is
   * parsed, replay whole-city EXPLOITATION from cached texts. Used
   * to re-project already-collected raw into the per-city project-state AND feed
   * PG (via `db`) without re-hitting the network (~2h45 of HEAD-skips avoided).
   *
   * Reexploit IMPLIES exploitation + the PG feed (it is pointless without `db`):
   * the caller (worker-live) always pairs `reexploit: true` with a `db` handle.
   * When set, this SUPERSEDES `exploit`/RECUEIL for every city: the adapter is
   * never constructed, so the injected `fetch` is never called. Composes with a
   * slug list / `--chunk` to select which cities to reexploit. Non-fatal per city:
   * a failure to reload/exploit a city becomes a `status: "error"` recap entry.
   */
  readonly reexploit?: boolean;
  /**
   * PDF→text extractor injected into EXPLOITATION (used when `exploit` OR
   * `reexploit`).
   * Defaults to `pdfToTextViaPoppler` (real poppler) in production; inject a mock
   * in tests. Absent poppler ⇒ a PDF yields empty text (0 signal, honest).
   */
  readonly pdfToText?: PdfToText;
  /**
   * Optional Drizzle DB handle propagated to EXPLOITATION's graph-feed (gated,
   * non-fatal). Only used when `exploit`.
   */
  readonly db?: Database;
  /**
   * Optional per-city callback invoked with each `LiveScrapeCityRecap` AS it is
   * produced (streamed), so a long all-cities run emits per-city progress instead
   * of nothing until the final recap. Pure side-channel (logging): never affects
   * control flow. It does NOT bound memory — the per-city working set (the raw PV
   * bytes held in `records`) is unaffected; see the worker-live memory follow-up.
   */
  readonly onCity?: (recap: LiveScrapeCityRecap) => void;
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
 * Sorted slugs of the config-only PV cities (scraped live — no `pvText` fixture),
 * i.e. the exact set `runLiveScrape(undefined, …)` processes. Deterministic order
 * so a `--chunk k/n` shard is stable across runs and jobs.
 */
export function configOnlyCitySlugs(): string[] {
  return ALL_PV_CITIES.filter((c) => !c.pvText)
    .map((c) => c.config.citySlug)
    .sort();
}

/**
 * The records EXPLOITATION must be fed for one city.
 *
 * WITHOUT the guard, `outcome.records` is everything the window retained, so it
 * is the whole picture and is used as is — that is what happened before the
 * guard existed.
 *
 * WITH the guard, `outcome.records` holds ONLY what this run downloaded, and on
 * a quiet night that is nothing. `runExploitation` assembles the city's
 * project-state from exactly the records it receives and PUTs it over
 * `ontology/{city}/project-state.json` — the key the Signaux view reads — so
 * feeding it this run's records would erase every signal of every past PV, every
 * night, silently. The corpus already on the store is therefore reloaded from
 * the per-document `*.meta.json` sidecars and merged with this run's records.
 *
 * Cost: a LIST plus one GET per sidecar. No network, and no poppler either —
 * `parseRawDoc` HEAD-skips a document whose `parsed/…` pair exists and reads the
 * cached text. A store that cannot LIST returns nothing, and the union then
 * degrades to this run's records: the same behaviour as before the guard.
 */
async function exploitationRecords(
  store: ObjectStore,
  citySlug: string,
  runRecords: readonly RawDocumentRecord[],
  guardActive: boolean,
): Promise<RawDocumentRecord[]> {
  if (!guardActive) return [...runRecords];
  const byKey = new Map<string, RawDocumentRecord>();
  for (const record of await loadScrapedPvRecords(store, citySlug)) {
    byKey.set(record.storageKey, record);
  }
  for (const record of runRecords) byKey.set(record.storageKey, record);
  return [...byKey.values()];
}

/**
 * The k-th (1-based) of `n` equal, contiguous shards of `all` (deterministic).
 * Shard size = ceil(len/n); the trailing shard may be shorter or empty. Callers
 * validate `1 <= k <= n` and `n >= 1`.
 */
export function citiesChunk(all: readonly string[], k: number, n: number): string[] {
  const size = Math.ceil(all.length / n);
  return all.slice((k - 1) * size, k * size);
}

/**
 * Scrape the requested (or all config-only) PV cities live and write to `store`.
 *
 * @param citySlugs Optional subset of city slugs; omit for all config-only.
 * @param options   `{ store, fetch?, limit?, windowDays?, now?, signal?, exploit?, reexploit?, pdfToText?, db? }`.
 *                  With `reexploit`, RECUEIL is skipped entirely: each city is
 *                  re-exploited from its already-stored raw (no network).
 * @returns         One {@link LiveScrapeCityRecap} per city, in input order.
 */
export async function runLiveScrape(
  citySlugs: readonly string[] | undefined,
  options: RunLiveScrapeOptions,
): Promise<LiveScrapeCityRecap[]> {
  const { store, fetch, limit, acceptRef, beforeFetch, windowDays, now, signal, onRequest,
    exploit, reexploit, db } =
    options;
  // Spacing is ON by default on the real network and OFF behind an injected
  // fetch: pacing a test double would add 2 s per fetch to the suite and
  // protect nobody. See `RunLiveScrapeOptions.minRequestIntervalMs`.
  const minRequestIntervalMs =
    options.minRequestIntervalMs ?? (fetch !== undefined ? 0 : PV_MIN_REQUEST_INTERVAL_MS);
  const skipAlreadyCollectedUrls = options.skipAlreadyCollectedUrls ?? false;
  const { configs, unknown } = resolveConfigs(citySlugs);
  let parseBudget = limit ?? 25;
  if (reexploit && (!Number.isSafeInteger(parseBudget) || parseBudget <= 0)) {
    throw new Error("reexploit limit must be a positive integer");
  }

  // Resolve the PDF→text extractor once (used when `exploit` OR `reexploit`).
  // Defaults to real poppler; tests inject a mock. A scrape source URL is not
  // meaningful here (we extract from raw bytes), so a generic label is passed to
  // the factory.
  const pdfToText: PdfToText | undefined =
    exploit || reexploit
      ? (options.pdfToText ?? pdfToTextViaPoppler("live-scrape"))
      : undefined;

  const recap: LiveScrapeCityRecap[] = [];
  // Collect the recap AND stream it per-city (observability): a long run emits
  // progress as each city finishes instead of only at the end.
  const pushRecap = (entry: LiveScrapeCityRecap): void => {
    recap.push(entry);
    options.onCity?.(entry);
  };

  // Unknown slugs surface as honest errors rather than being silently dropped.
  for (const slug of unknown) {
    pushRecap({
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
      pushRecap({
        city: config.citySlug,
        sourceId: config.sourceId,
        status: "error",
        casKeys: [],
        count: 0,
        error: "aborted",
      });
      continue;
    }

    // REEXPLOIT (no network): reconstruct the stored records from the object
    // store and replay PARSE + EXPLOITATION (+ PG feed via `db`). The adapter is
    // NEVER constructed here, so the injected `fetch` is never called. Non-fatal:
    // a reload/exploit failure becomes a per-city `status: "error"` recap entry.
    if (reexploit) {
      try {
        const { result, progress } = await reexploitScrapedCityChunk(store, config.citySlug, parseBudget, {
          ...(pdfToText !== undefined ? { pdfToText } : {}),
          ...(now !== undefined ? { now } : {}),
          ...(db !== undefined ? { db } : {}),
        });
        parseBudget -= progress.newDocuments;
        if (result?.exploitation.graphFeed?.ok === false) {
          throw new Error(result.exploitation.graphFeed.error ?? "reexploit PG feed failed");
        }
        pushRecap({
          city: config.citySlug,
          sourceId: config.sourceId,
          // No scrape ran: nothing new was written to raw CAS this run, so the
          // aggregate scrape status is `seen` (the raw was already collected).
          status: "seen",
          casKeys: result?.parsed.map((p) => p.rawRef) ?? [],
          count: progress.newDocuments + progress.skippedExisting,
          ...(result ? { signals: result.designationEventCount } : {}),
          reexploitProgress: progress,
        });
      } catch (e) {
        pushRecap({
          city: config.citySlug,
          sourceId: config.sourceId,
          status: "error",
          casKeys: [],
          count: 0,
          error: e instanceof Error ? e.message : String(e),
        });
        // A failed tranche may have consumed its budget before throwing.
        // Stop this process; a retry resumes from durable parsed pairs.
        break;
      }
      continue;
    }

    const adapter = new ProcesVerbauxGenericAdapter(config, {
      ...(onRequest ? { onRequest: (diagnostic: PvFetchDiagnostic) =>
        onRequest({ city: config.citySlug, ...diagnostic }) } : {}),
      ...(fetch !== undefined ? { fetchImpl: fetch } : {}),
      ...(windowDays !== undefined ? { windowDays } : {}),
      ...(now !== undefined ? { now } : {}),
      minRequestIntervalMs,
    });

    // THE DAILY CHECK IS THE INDEX, NOT THE BACK CATALOGUE (issue #723). The
    // index page above is always fetched, so a document appearing today is
    // discovered today. What is skipped is a document whose URL an earlier run
    // already collected and stored — re-downloading it buys nothing, and is
    // what made one city pull 255 files a night.
    const guardState = skipAlreadyCollectedUrls
      ? await loadCollectedUrls(store, config.sourceId)
      : undefined;
    const outcome = await runRecueilWithManifest(config.sourceId, adapter, store, {
      ...(limit !== undefined ? { limit } : {}),
      ...(acceptRef !== undefined ? { acceptRef } : {}),
      ...(guardState !== undefined ? { alreadyCollected: guardState.urls } : {}),
      ...(beforeFetch !== undefined ? { beforeFetch } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });

    // `ok: false` now means the source could collect NOTHING (index / sitemap
    // unreachable), so `count: 0` is a fact here rather than an erasure. A run
    // that collected documents and then hit a failure comes back `ok: true`,
    // with its harvest and its holes both reported below.
    if (!outcome.ok) {
      pushRecap({
        city: config.citySlug,
        sourceId: config.sourceId,
        status: "error",
        casKeys: [],
        count: 0,
        error: `[${outcome.error}] ${outcome.detail}`,
        ...(outcome.fetchFailure ? { fetchFailure: outcome.fetchFailure } : {}),
      });
      continue;
    }

    // PERSIST THE GUARD STATE, MONOTONICALLY. The set read above plus the URLs
    // this run actually collected — nothing is ever removed, so a night that
    // collected nothing writes back exactly what it read. Written even when
    // nothing was added the first time a source is seen, so the one-off
    // bootstrap from past manifests is not redone every night. A failure to
    // write costs re-downloads next run and must never cost the city, so it is
    // swallowed by `saveCollectedUrls`.
    if (guardState) {
      const before = guardState.urls.size;
      for (const entry of outcome.manifestEntries) guardState.urls.add(entry.sourceUrl);
      if (guardState.urls.size !== before || !guardState.fromState) {
        await saveCollectedUrls(store, config.sourceId, guardState.urls);
      }
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
        const records = await exploitationRecords(
          store,
          config.citySlug,
          outcome.records,
          guardState !== undefined,
        );
        // NOTHING NEW ⇒ NOTHING TO RE-PROJECT. The city's project-state already
        // describes every document in storage, so re-deriving it would spend a
        // full corpus read and a PG upsert to write the same thing. Leaving it
        // untouched is both cheaper and safer: `runExploitation` PUTs the state
        // it assembles over `ontology/{city}/project-state.json` — the key the
        // Signaux view reads — so a run with nothing to assemble must not reach
        // it at all. `signals` stays undefined, which is how the recap says
        // "not re-derived" rather than "zero signals".
        if (records.length === 0 || outcome.records.length === 0) {
          // Nothing collected this run: leave the projected state as it stands.
        } else {
          const result: ExploitScrapeResult = await exploitScrapedCity(
            store,
            config.citySlug,
            {
              records,
              ...(pdfToText !== undefined ? { pdfToText } : {}),
              ...(now !== undefined ? { now } : {}),
              ...(db !== undefined ? { db } : {}),
            },
          );
          signals = result.designationEventCount;
        }
      } catch (e) {
        signals = 0;
        exploitError = e instanceof Error ? e.message : String(e);
      }
    }

    // A document that failed is reported ALONGSIDE what was collected, never
    // instead of it: `count` stays the number of documents actually in the CAS.
    pushRecap({
      city: config.citySlug,
      sourceId: config.sourceId,
      status: anyNew ? "new" : "seen",
      casKeys: outcome.manifestEntries.map((e) => e.casKey),
      count: outcome.count,
      ...(outcome.skippedKnown > 0 ? { skippedKnown: outcome.skippedKnown } : {}),
      ...(outcome.documentFailures.length > 0
        ? {
            failedDocs: outcome.documentFailures.length,
            documentFailures: outcome.documentFailures.slice(
              0,
              MAX_REPORTED_DOCUMENT_FAILURES,
            ),
          }
        : {}),
      ...(outcome.listingTruncatedBy !== undefined
        ? { listingTruncatedBy: outcome.listingTruncatedBy }
        : {}),
      ...(signals !== undefined ? { signals } : {}),
      ...(exploitError !== undefined ? { exploitError } : {}),
    });
  }

  return recap;
}
