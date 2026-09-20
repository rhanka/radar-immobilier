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
 *  - **Bounded cost.** The sweep stops on a wall-clock budget and on a maximum
 *    number of EXTRACTED documents, so the daily model spend has a ceiling that
 *    does not depend on how many municipalities happen to publish that night.
 *  - **Measurability.** Every city produces one entry, and every extracted
 *    document produces one `refresh_document_outcomes` row carrying the sweep's
 *    single `cycleId` — so the progress of one run is a single GROUP BY.
 */

import type { ObjectStore } from "../../storage/object-store.js";

/** Where a city landed this sweep. Only `failed` is an anomaly. */
export type RefreshCityOutcome =
  /** A document was extracted and projected this run. */
  | "published"
  /** Every candidate document is already published and projected. */
  | "up-to-date"
  /** RECUEIL returned nothing usable (source down, or no PV in the window). */
  | "no-input"
  /** The city published something, but no exact PDF representation. */
  | "no-pdf"
  /** The city has no canonical graph yet, so a refresh has no baseline to build on. */
  | "no-baseline"
  /** Anything else: an unexpected failure that deserves attention. */
  | "failed";

/** Why the sweep stopped before, or after, visiting every city. */
export type RefreshSweepStop = "exhausted" | "deadline" | "document-budget" | "aborted";

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
  /** One city's refresh. Resolves with the per-city status, or throws. */
  readonly refreshCity: (citySlug: string) => Promise<{ readonly status?: string } | void>;
  /** Wall-clock budget for the whole sweep, in milliseconds. */
  readonly deadlineMs: number;
  /** Cap on documents actually extracted this run; bounds the model spend. */
  readonly maxDocuments: number;
  /**
   * Budget a city is assumed to need. The sweep does not start a city when less
   * than this remains, so it stops cleanly instead of being killed mid-city by
   * the Job deadline with a stale cursor.
   */
  readonly cityReserveMs: number;
  readonly now?: () => number;
  readonly onCity?: (entry: RefreshSweepEntry) => void;
  readonly signal?: AbortSignal;
}

/** Durable rotation cursor. One small object, shared by every city of the sweep. */
export const REFRESH_SWEEP_CURSOR_KEY = "refresh/018/sweep/cursor.json";

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

/**
 * Classify a per-city failure from its reason CODE, never from its message.
 * Messages carry city names and upstream text; codes are a closed vocabulary.
 */
export function classifyRefreshCityError(error: unknown): RefreshCityOutcome {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return (typeof code === "string" ? OUTCOME_BY_CODE[code] : undefined) ?? "failed";
}

/** Read the durable cursor, tolerating an absent, unreadable or stale one. */
export async function readRefreshSweepCursor(store: ObjectStore): Promise<string | null> {
  try {
    if (!(await store.head(REFRESH_SWEEP_CURSOR_KEY))) return null;
    const cursor = JSON.parse(new TextDecoder().decode(
      await store.get(REFRESH_SWEEP_CURSOR_KEY))) as Partial<RefreshSweepCursor>;
    if (cursor.schemaVersion !== 1) return null;
    return typeof cursor.nextCity === "string" ? cursor.nextCity : null;
  } catch {
    // A corrupt cursor must not stop the refresh; a full sweep from the first
    // slug is always a correct, if less efficient, behaviour.
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
  return { published: 0, "up-to-date": 0, "no-input": 0, "no-pdf": 0, "no-baseline": 0, failed: 0 };
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
  const { cities } = options;
  const counts = emptyCounts();
  const entries: RefreshSweepEntry[] = [];
  if (cities.length === 0) {
    return { visited: 0, counts, entries, nextCity: null, completedFullSweep: true,
      stoppedBy: "exhausted", documentsExtracted: 0 };
  }
  const startedAt = now();
  const resumeAt = await readRefreshSweepCursor(options.store);
  const resumeIndex = resumeAt === null ? 0 : cities.indexOf(resumeAt);
  // An unknown cursor slug (the city list changed under it) restarts the rotation
  // rather than silently skipping part of the list.
  let index = resumeIndex >= 0 ? resumeIndex : 0;
  let documentsExtracted = 0;
  let stoppedBy: RefreshSweepStop = "exhausted";
  let visited = 0;

  for (let step = 0; step < cities.length; step++) {
    if (options.signal?.aborted) { stoppedBy = "aborted"; break; }
    if (now() - startedAt + options.cityReserveMs > options.deadlineMs) { stoppedBy = "deadline"; break; }
    if (documentsExtracted >= options.maxDocuments) { stoppedBy = "document-budget"; break; }

    const citySlug = cities[index]!;
    index = (index + 1) % cities.length;
    await writeRefreshSweepCursor(options.store, cities[index]!, now);
    const cityStartedAt = now();
    let outcome: RefreshCityOutcome;
    let reason: string | undefined;
    try {
      const result = await options.refreshCity(citySlug);
      outcome = result && result.status === "up-to-date" ? "up-to-date" : "published";
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
    completedFullSweep: visited === cities.length, stoppedBy, documentsExtracted };
}

/**
 * JOB HEALTH, mirroring `worker-live`: per-city source errors are tolerated data
 * quality, a systemic rate of UNEXPECTED failures is not. `no-input`, `no-pdf`
 * and `no-baseline` are expected states of a 528-city list and never fail a run.
 */
export function assessRefreshSweepHealth(
  report: RefreshSweepReport,
  maxFailureRate: number,
): { exitCode: 0 | 1; reason?: string } {
  if (report.visited === 0) return { exitCode: 1, reason: "no-city-visited" };
  const rate = report.counts.failed / report.visited;
  if (rate >= maxFailureRate) return { exitCode: 1, reason: "systemic-city-failures" };
  return { exitCode: 0 };
}
