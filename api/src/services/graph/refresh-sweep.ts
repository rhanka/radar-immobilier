/**
 * REFRESH SWEEP — drive the per-city refresh over EVERY configured city instead
 * of one hard-coded slug.
 *
 * The cycle's unit of work stays `runPvRefresh(city)`: one city, one document,
 * one durable identity. This module only decides WHICH cities that unit visits,
 * IN WHICH ORDER, WHEN TO STOP, and what a per-city failure means for the run.
 * Four properties are worth stating because they are the ones a daily job needs:
 *
 *  - **Isolation.** A city that cannot be refreshed — its source is down, it has
 *    no procès-verbal in the window, it has no canonical baseline yet — is a
 *    normal data-quality event, not a run failure. It is counted and the sweep
 *    continues. Only a systemic rate of hard failures fails the run.
 *  - **Coverage.** The city list is deterministic and the sweep resumes from a
 *    durable cursor, so a run truncated by the Job deadline continues from where
 *    it stopped instead of restarting at the first slug. Without the cursor the
 *    tail of the list would never be visited at all.
 *  - **Nothing is dropped, only deferred.** There is no daily ceiling on
 *    documents (owner decision, 2026-09-20). When extraction DOES have to stop —
 *    an explicit submission budget, or a fallback seat out of quota — the sweep
 *    keeps VISITING the rest of the list with extraction off, so every city is
 *    still re-scraped and its coverage ledger kept current. The documents passed
 *    over stay `pending` in their city's ledger and the next sweep finds them
 *    again: a retry queue, not an abandonment.
 *  - **Measurability.** Every city produces one entry, every extracted document
 *    produces one `refresh_document_outcomes` row carrying the sweep's single
 *    `cycleId`, and the whole report is persisted so "how many cities were
 *    re-scraped today" is answerable after the pod's logs have expired.
 */

import type { ObjectStore } from "../../storage/object-store.js";

/** Where a city landed this sweep. Only `failed` is an anomaly. */
export type RefreshCityOutcome =
  /** A document was extracted and projected this run. */
  | "published"
  /** Every candidate document is already covered. */
  | "up-to-date"
  /** The city owes a document, but this run is no longer extracting. */
  | "deferred"
  /** RECUEIL returned nothing usable (source down, or no PV in the window). */
  | "no-input"
  /** The city published something, but no exact PDF representation. */
  | "no-pdf"
  /** The city has no canonical graph yet, so a refresh has no baseline to build on. */
  | "no-baseline"
  /** Anything else: an unexpected failure that deserves attention. */
  | "failed";

/** Why the sweep stopped before, or after, visiting every city. */
export type RefreshSweepStop = "exhausted" | "deadline" | "aborted";

export interface RefreshSweepEntry {
  readonly citySlug: string;
  readonly outcome: RefreshCityOutcome;
  /** Redacted reason code; never an upstream message. */
  readonly reason?: string;
  readonly durationMs: number;
}

export interface RefreshSweepReport {
  readonly visited: number;
  readonly counts: Readonly<Record<RefreshCityOutcome, number>>;
  readonly entries: readonly RefreshSweepEntry[];
  /** The slug the next run starts from. */
  readonly nextCity: string | null;
  /** True when this single run visited every city of the list. */
  readonly completedFullSweep: boolean;
  readonly stoppedBy: RefreshSweepStop;
  readonly documentsExtracted: number;
  /** Model calls actually sent this run, refusals included. */
  readonly submissions: number;
  /** Set when extraction was switched off for the tail of the list. */
  readonly extractionHaltedBy?: string;
  /** Cities whose cursor write failed; the rotation continued regardless. */
  readonly cursorWriteFailures: number;
}

export interface RefreshSweepCursor {
  readonly schemaVersion: 1;
  readonly nextCity: string | null;
  readonly updatedAt: string;
}

export interface RefreshSweepOptions {
  /** Deterministic city list; the sweep never reorders it. */
  readonly cities: readonly string[];
  readonly store: ObjectStore;
  /**
   * One city's refresh. Resolves with the per-city status, or throws.
   * `extract: false` means "re-scrape and keep the ledger current, spend
   * nothing" — the mode the sweep falls back to instead of stopping.
   */
  readonly refreshCity: (
    citySlug: string,
    mode: { readonly extract: boolean },
  ) => Promise<{ readonly status?: string } | void>;
  /** Wall-clock budget for the whole sweep, in milliseconds. */
  readonly deadlineMs: number;
  /**
   * Optional cap on model SUBMISSIONS — calls actually sent, refused ones
   * included. Zero means no cap, which is the configured default: the daily
   * volume is what the municipalities publish, not a number chosen in advance.
   * A non-zero value switches extraction off for the rest of the run rather
   * than ending it.
   */
  readonly maxSubmissions: number;
  /** Live count of submissions paid so far; required for `maxSubmissions`. */
  readonly submissions?: () => number;
  /**
   * Returns a redacted reason code when extraction must stop for the rest of
   * the run — a fallback seat out of quota, typically. The sweep keeps visiting.
   */
  readonly haltExtraction?: () => string | null;
  /**
   * Budget a city is assumed to need. The sweep does not start a city when less
   * than this remains, so it stops cleanly instead of being killed mid-city by
   * the Job deadline with a stale cursor. It must cover one model call, since
   * any city may turn out to owe a document.
   */
  readonly cityReserveMs: number;
  readonly now?: () => number;
  readonly onCity?: (entry: RefreshSweepEntry) => void;
  /** Redacted operational notes: cursor trouble, extraction halted, and so on. */
  readonly onNote?: (note: string, detail?: Record<string, unknown>) => void;
  readonly signal?: AbortSignal;
}

/** Durable rotation cursor. One small object, shared by every city of the sweep. */
export const REFRESH_SWEEP_CURSOR_KEY = "refresh/018/sweep/cursor.json";

/** Where a finished sweep's own report is kept, beyond the pod log's 24 h. */
export const REFRESH_SWEEP_REPORT_PREFIX = "refresh/018/sweep/reports/";
export const REFRESH_SWEEP_LATEST_REPORT_KEY = "refresh/018/sweep/latest.json";

/**
 * `--all` (the whole list) or exactly one city slug; anything else is refused.
 *
 * Lives here rather than in the entry script so it is unit-testable: importing
 * `refresh-pv.ts` would run its `main()`. A malformed invocation must fail loudly
 * — the silent variant of this decision is the bug being fixed, a daily job that
 * looked like it refreshed everything and refreshed one hard-coded city.
 */
export function parseRefreshTarget(argv: readonly string[]): { all: boolean; citySlug?: string } {
  const flags = argv.filter((argument) => argument.startsWith("--"));
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const unknown = flags.filter((flag) => flag !== "--all");
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  const all = flags.includes("--all");
  if (all && positional.length > 0) {
    throw new Error("Usage: refresh-pv.ts --all | <city-slug> (not both)");
  }
  if (!all && positional.length !== 1) throw new Error("Usage: refresh-pv.ts --all | <city-slug>");
  const citySlug = positional[0]?.trim();
  if (!all && !citySlug) throw new Error("Usage: refresh-pv.ts --all | <city-slug>");
  return all ? { all: true } : { all: false, citySlug: citySlug! };
}

const OUTCOME_BY_CODE: Readonly<Record<string, RefreshCityOutcome>> = {
  REFRESH_NO_ACQUISITION: "no-input",
  REFRESH_NO_PDF: "no-pdf",
  REFRESH_NO_BASELINE: "no-baseline",
};

const OUTCOME_BY_STATUS: Readonly<Record<string, RefreshCityOutcome>> = {
  published: "published",
  "up-to-date": "up-to-date",
  deferred: "deferred",
};

/**
 * Classify a per-city failure from its reason CODE, never from its message.
 * Messages carry city names and upstream text; codes are a closed vocabulary.
 */
export function classifyRefreshCityError(error: unknown): RefreshCityOutcome {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return (typeof code === "string" ? OUTCOME_BY_CODE[code] : undefined) ?? "failed";
}

/**
 * Classify a per-city SUCCESS from its declared status. An unknown or missing
 * status is a contract break, not a publication: counting it as published is how
 * a sweep would report model spend it never made.
 */
export function classifyRefreshCityStatus(result: { readonly status?: string } | void): RefreshCityOutcome {
  const status = result && typeof result === "object" ? result.status : undefined;
  return (typeof status === "string" ? OUTCOME_BY_STATUS[status] : undefined) ?? "failed";
}

/** Read the durable cursor, tolerating an absent, unreadable or stale one. */
export async function readRefreshSweepCursor(
  store: ObjectStore,
  onNote?: (note: string) => void,
): Promise<string | null> {
  try {
    if (!(await store.head(REFRESH_SWEEP_CURSOR_KEY))) return null;
    const cursor = JSON.parse(new TextDecoder().decode(
      await store.get(REFRESH_SWEEP_CURSOR_KEY))) as Partial<RefreshSweepCursor>;
    if (cursor.schemaVersion !== 1) {
      onNote?.("cursor-schema-unknown");
      return null;
    }
    return typeof cursor.nextCity === "string" ? cursor.nextCity : null;
  } catch {
    // A corrupt cursor must not stop the refresh; a full sweep from the first
    // slug is always a correct, if less efficient, behaviour. It IS reported:
    // a cursor that is unreadable every day silently pins the rotation on the
    // head of the list, and the tail is never visited.
    onNote?.("cursor-unreadable");
    return null;
  }
}

export async function writeRefreshSweepCursor(
  store: ObjectStore,
  nextCity: string | null,
  now: () => number,
): Promise<void> {
  const cursor: RefreshSweepCursor = {
    schemaVersion: 1, nextCity, updatedAt: new Date(now()).toISOString(),
  };
  await store.put(REFRESH_SWEEP_CURSOR_KEY, JSON.stringify(cursor), "application/json");
}

function emptyCounts(): Record<RefreshCityOutcome, number> {
  return { published: 0, "up-to-date": 0, deferred: 0, "no-input": 0, "no-pdf": 0,
    "no-baseline": 0, failed: 0 };
}

/**
 * Where to resume from when the cursor names a slug the list no longer has.
 *
 * The list is sorted, so the first slug at or after the cursor is exactly the
 * position the removed city occupied. Restarting at index 0 instead would, on a
 * run that does not reach the end of the list, push the whole tail back by a
 * full rotation every time a city is renamed or removed.
 */
export function resolveRefreshSweepResume(cities: readonly string[], resumeAt: string | null): number {
  if (resumeAt === null) return 0;
  const exact = cities.indexOf(resumeAt);
  if (exact >= 0) return exact;
  const sorted = cities.every((city, index) => index === 0 || cities[index - 1]! <= city);
  if (!sorted) return 0;
  const next = cities.findIndex((city) => city >= resumeAt);
  return next >= 0 ? next : 0;
}

/**
 * Visit every city once, starting at the durable cursor and wrapping around.
 *
 * The cursor is persisted BEFORE each city is worked on, not after, and never
 * only at the end. The CronJob enforces its own `activeDeadlineSeconds` and will
 * SIGKILL the pod, so a cursor written on a clean exit would be lost exactly in
 * the case it exists for — and a cursor written after the work would pin the
 * rotation forever on the first city that cannot finish inside a run. Advancing
 * first costs one full rotation before a killed city is retried, and buys the
 * guarantee that no city can starve the ones behind it. A retried city resumes
 * from its own durable chunk state, so nothing already paid for is lost.
 */
export async function runRefreshSweep(options: RefreshSweepOptions): Promise<RefreshSweepReport> {
  const now = options.now ?? (() => Date.now());
  const note = options.onNote ?? (() => {});
  const { cities } = options;
  const counts = emptyCounts();
  const entries: RefreshSweepEntry[] = [];
  if (cities.length === 0) {
    return { visited: 0, counts, entries, nextCity: null, completedFullSweep: true,
      stoppedBy: "exhausted", documentsExtracted: 0, submissions: 0, cursorWriteFailures: 0 };
  }
  const startedAt = now();
  const resumeAt = await readRefreshSweepCursor(options.store, note);
  let index = resolveRefreshSweepResume(cities, resumeAt);
  if (resumeAt !== null && cities[index] !== resumeAt) note("cursor-slug-missing", { resumeAt });
  let documentsExtracted = 0;
  let stoppedBy: RefreshSweepStop = "exhausted";
  let visited = 0;
  let extracting = true;
  let extractionHaltedBy: string | undefined;
  let cursorWriteFailures = 0;
  const submissions = () => options.submissions?.() ?? 0;

  for (let step = 0; step < cities.length; step++) {
    if (options.signal?.aborted) { stoppedBy = "aborted"; break; }
    if (now() - startedAt + options.cityReserveMs > options.deadlineMs) { stoppedBy = "deadline"; break; }
    if (extracting) {
      // Extraction can be switched off — never the visit. A city that is not
      // re-scraped is a city whose ledger goes stale and whose next sweep has
      // no idea what it published in between.
      const halted = options.haltExtraction?.() ?? null;
      const overBudget = options.maxSubmissions > 0 && submissions() >= options.maxSubmissions;
      if (halted || overBudget) {
        extracting = false;
        extractionHaltedBy = halted ?? "submission-budget";
        note("extraction-halted", { reason: extractionHaltedBy, submissions: submissions() });
      }
    }

    const citySlug = cities[index]!;
    index = (index + 1) % cities.length;
    try {
      await writeRefreshSweepCursor(options.store, cities[index]!, now);
    } catch {
      // A transient PUT failure on one small object must not end the sweep. The
      // cost is bounded: the next run resumes from the last cursor that stuck.
      cursorWriteFailures += 1;
      note("cursor-write-failed", { citySlug });
    }
    const cityStartedAt = now();
    let outcome: RefreshCityOutcome;
    let reason: string | undefined;
    try {
      outcome = classifyRefreshCityStatus(await options.refreshCity(citySlug, { extract: extracting }));
      if (outcome === "failed") reason = "unknown-status";
      if (outcome === "published") documentsExtracted += 1;
    } catch (error) {
      outcome = classifyRefreshCityError(error);
      reason = outcome;
    }
    const entry: RefreshSweepEntry = { citySlug, outcome,
      ...(reason ? { reason } : {}), durationMs: now() - cityStartedAt };
    entries.push(entry);
    counts[outcome] += 1;
    visited += 1;
    options.onCity?.(entry);
  }

  return { visited, counts, entries, nextCity: cities[index]!,
    completedFullSweep: visited === cities.length, stoppedBy, documentsExtracted,
    submissions: submissions(), cursorWriteFailures,
    ...(extractionHaltedBy ? { extractionHaltedBy } : {}) };
}

/**
 * Minimum number of cities that tried to extract before a failure RATE means
 * anything. The steady-state sweep extracts a handful of documents a day: one
 * failure out of one attempt is 100 %, and would fail every run that happened
 * to meet a single broken PDF.
 */
export const REFRESH_SWEEP_MINIMUM_ATTEMPTS = 5;

/**
 * JOB HEALTH, mirroring `worker-live`: per-city source errors are tolerated data
 * quality, a systemic rate of UNEXPECTED failures is not. `no-input`, `no-pdf`
 * and `no-baseline` are expected states of a 528-city list and never fail a run.
 *
 * The rate is computed over the cities that actually ATTEMPTED an extraction.
 * Diluting it over all 528 visits — most of which have nothing to do — makes any
 * threshold unreachable, which is how a seat running out of quota mid-sweep
 * would have produced a green Job that extracted nothing.
 */
export function assessRefreshSweepHealth(
  report: RefreshSweepReport,
  maxFailureRate: number,
): { exitCode: 0 | 1; reason?: string } {
  if (report.visited === 0) return { exitCode: 1, reason: "no-city-visited" };
  if (report.extractionHaltedBy && report.extractionHaltedBy !== "submission-budget") {
    return { exitCode: 1, reason: report.extractionHaltedBy };
  }
  const attempted = report.counts.published + report.counts.failed;
  if (attempted < REFRESH_SWEEP_MINIMUM_ATTEMPTS) return { exitCode: 0 };
  if (report.counts.failed / attempted >= maxFailureRate) {
    return { exitCode: 1, reason: "systemic-city-failures" };
  }
  return { exitCode: 0 };
}

/**
 * Persist the run's own report. The per-city log lines live in the pod, which
 * is garbage-collected a day later; "how many cities did we re-scrape, how many
 * new procès-verbaux did we see" has to survive that.
 */
export async function writeRefreshSweepReport(
  store: ObjectStore,
  cycleId: string,
  report: RefreshSweepReport & { readonly startedAt: string; readonly finishedAt: string },
): Promise<void> {
  const body = JSON.stringify({ schemaVersion: 1, cycleId, ...report });
  await store.put(`${REFRESH_SWEEP_REPORT_PREFIX}${cycleId}.json`, body, "application/json");
  await store.put(REFRESH_SWEEP_LATEST_REPORT_KEY, body, "application/json");
}
