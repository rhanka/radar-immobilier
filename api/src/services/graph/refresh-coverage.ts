/**
 * REFRESH COVERAGE — the memory of which municipal documents the refresh has
 * already turned into signals, and of the ones it still owes.
 *
 * One small JSON object per city, and three properties that the durable run
 * states (`refresh/018/<city>/runs/*`) cannot provide:
 *
 *  - **Independent of the execution configuration.** An entry is keyed by the
 *    city and the document's sha256, and by nothing else. Run states are keyed
 *    by the whole run identity — profile hash, registry hash, package version,
 *    model policy string. Reading the memory from those would mean that
 *    flipping `REFRESH_FORCE_FALLBACK` because a seat is dry, or moving to a
 *    newer model, puts EVERY document of EVERY city back in the queue and pays
 *    for the whole corpus again. Which model extracted a document is an
 *    execution fact; THAT the document has been covered is a product fact.
 *  - **Primed on the first visit.** A city's first visit records everything the
 *    source offers as covered, without one model call. The refresh is a
 *    forward-looking daily sweep: it treats what APPEARS after that point.
 *    Documents already projected by the bulk processing keep the extraction
 *    quality of the policy that produced them; they are not re-extracted.
 *  - **A retry queue, not a best effort.** A document seen once is `pending`
 *    until its signals reach Postgres. Passing on it — no budget left, a
 *    fallback out of quota, a source-side error — leaves it pending, and the
 *    next sweep finds it again even though RECUEIL now reports it as `seen`.
 *    Repeated failures are counted, and a document that keeps failing is set
 *    aside (`abandoned`) so it stops blocking the documents behind it and stops
 *    paying for the same refusal on every rotation.
 */

import type { ObjectStore } from "../../storage/object-store.js";

export type RefreshCoverageState =
  /** Seen, owed: the retry queue. */
  | "pending"
  /** Its signals are in Postgres, or it predates the city's priming. */
  | "covered"
  /** Set aside after too many failures; never selected again without an operator. */
  | "abandoned";

export interface RefreshCoverageEntry {
  readonly state: RefreshCoverageState;
  readonly sourceId: string;
  /** CAS key of the exact representation, so a pending document stays reachable
   *  even once it has dropped out of the source's look-back window. */
  readonly representationKey: string;
  readonly firstSeenAt: string;
  readonly updatedAt: string;
  /** Failed extraction attempts, successes excluded. */
  readonly failures: number;
  /** Redacted reason code of the last failure. */
  readonly lastReason?: string;
  /** Source publication date, when the index exposes one. */
  readonly publishedAt?: string;
}

export interface RefreshCoverageLedger {
  readonly schemaVersion: 1;
  readonly citySlug: string;
  /**
   * When the city's existing corpus was taken as already covered. Absent until
   * the first visit, which is exactly what distinguishes "this city has never
   * been swept" from "nothing new since the last sweep".
   */
  readonly primedAt?: string;
  readonly updatedAt: string;
  readonly documents: Readonly<Record<string, RefreshCoverageEntry>>;
}

/** The minimum a candidate must carry to be tracked. */
export interface RefreshCoverageCandidate {
  readonly sha: string;
  readonly sourceId: string;
  readonly representationKey: string;
  readonly publishedAt?: string;
}

/** A document this city owes, in the order the cycle should try them. */
export interface RefreshCoverageWorkItem extends RefreshCoverageCandidate {
  /** False when the document is only known from the ledger: it has dropped out
   *  of the source's window but was never covered, so it is still owed. */
  readonly listed: boolean;
  readonly failures: number;
}

const SHA256 = /^[0-9a-f]{64}$/;

export function refreshCoverageKey(citySlug: string): string {
  return `refresh/018/${citySlug}/coverage.json`;
}

export function emptyRefreshCoverage(citySlug: string, now: () => Date): RefreshCoverageLedger {
  return { schemaVersion: 1, citySlug, updatedAt: now().toISOString(), documents: {} };
}

function validLedger(value: unknown, citySlug: string): value is RefreshCoverageLedger {
  if (!value || typeof value !== "object") return false;
  const ledger = value as Partial<RefreshCoverageLedger>;
  return ledger.schemaVersion === 1 && ledger.citySlug === citySlug
    && !!ledger.documents && typeof ledger.documents === "object";
}

/**
 * Read a city's ledger, or `null` when it is absent, unreadable or foreign.
 *
 * `null` is deliberately indistinguishable from "never swept": a corrupt ledger
 * makes the city re-prime, which costs nothing and extracts nothing. The one
 * thing it loses is the pending queue, so the caller LOGS the difference
 * between an absent and an unreadable ledger instead of swallowing it.
 */
export async function readRefreshCoverage(
  store: ObjectStore,
  citySlug: string,
): Promise<{ ledger: RefreshCoverageLedger | null; unreadable: boolean }> {
  const key = refreshCoverageKey(citySlug);
  try {
    if (!(await store.head(key))) return { ledger: null, unreadable: false };
    const parsed: unknown = JSON.parse(new TextDecoder().decode(await store.get(key)));
    if (!validLedger(parsed, citySlug)) return { ledger: null, unreadable: true };
    return { ledger: parsed, unreadable: false };
  } catch {
    return { ledger: null, unreadable: true };
  }
}

export async function writeRefreshCoverage(
  store: ObjectStore,
  ledger: RefreshCoverageLedger,
): Promise<void> {
  await store.put(refreshCoverageKey(ledger.citySlug), JSON.stringify(ledger), "application/json");
}

export interface PlanRefreshCoverageOptions {
  /**
   * Take the city's existing corpus as covered on its FIRST visit. True for the
   * daily whole-list sweep — the owner's decision of 2026-09-20: new documents
   * only, the 4 166 minutes already in the graph are not re-extracted. False
   * for a targeted single-city run, where the operator asked for that city.
   */
  readonly primeExisting: boolean;
  /** Failures after which a document is set aside. */
  readonly maxFailures: number;
  readonly now: () => Date;
}

/**
 * Fold this cycle's candidates into the ledger and return what the city owes.
 *
 * Pure: it returns the next ledger rather than writing it, so the caller
 * persists once, and the whole selection is unit-testable without a store.
 */
export function planRefreshCoverage(
  current: RefreshCoverageLedger | null,
  citySlug: string,
  candidates: readonly RefreshCoverageCandidate[],
  options: PlanRefreshCoverageOptions,
): { ledger: RefreshCoverageLedger; changed: boolean; workItems: readonly RefreshCoverageWorkItem[] } {
  const timestamp = options.now().toISOString();
  const base = current ?? emptyRefreshCoverage(citySlug, options.now);
  const documents: Record<string, RefreshCoverageEntry> = { ...base.documents };
  // A city that has never been swept and is being primed adopts its whole
  // current corpus as covered. Without a ledger yet, "new to the sweep" and
  // "new to the world" are the same thing, and only the second deserves a
  // model call.
  const priming = options.primeExisting && base.primedAt === undefined;
  let changed = false;
  for (const candidate of candidates) {
    if (!SHA256.test(candidate.sha)) throw new Error("Invalid refresh coverage document hash");
    if (documents[candidate.sha]) continue;
    documents[candidate.sha] = {
      state: priming ? "covered" : "pending",
      sourceId: candidate.sourceId,
      representationKey: candidate.representationKey,
      firstSeenAt: timestamp,
      updatedAt: timestamp,
      failures: 0,
      ...(priming ? { lastReason: "primed" } : {}),
      ...(candidate.publishedAt !== undefined ? { publishedAt: candidate.publishedAt } : {}),
    };
    changed = true;
  }
  const ledger: RefreshCoverageLedger = {
    schemaVersion: 1,
    citySlug,
    ...(priming || base.primedAt !== undefined
      ? { primedAt: base.primedAt ?? timestamp } : {}),
    updatedAt: changed || priming ? timestamp : base.updatedAt,
    documents,
  };
  changed = changed || (priming && base.primedAt === undefined);
  return { ledger, changed, workItems: refreshCoverageWorkItems(ledger, candidates, options.maxFailures) };
}

/**
 * What the city owes, most recently published first.
 *
 * Listed candidates keep the caller's order, which is already newest-first.
 * A pending document the source no longer lists comes last: it is still owed —
 * its bytes are in the CAS and nothing has covered it — but a document still on
 * the index page is the fresher signal, and the cycle only pays for one.
 */
export function refreshCoverageWorkItems(
  ledger: RefreshCoverageLedger,
  candidates: readonly RefreshCoverageCandidate[],
  maxFailures: number,
): readonly RefreshCoverageWorkItem[] {
  const owed = (sha: string): RefreshCoverageEntry | null => {
    const entry = ledger.documents[sha];
    return entry && entry.state === "pending" && entry.failures < maxFailures ? entry : null;
  };
  const listed = new Set(candidates.map((candidate) => candidate.sha));
  const items: RefreshCoverageWorkItem[] = [];
  for (const candidate of candidates) {
    const entry = owed(candidate.sha);
    if (entry) items.push({ ...candidate, listed: true, failures: entry.failures });
  }
  const unlisted = Object.entries(ledger.documents)
    .filter(([sha, entry]) => !listed.has(sha) && entry.state === "pending" && entry.failures < maxFailures)
    .sort((a, b) => (b[1].publishedAt ?? "").localeCompare(a[1].publishedAt ?? "") || a[0].localeCompare(b[0]));
  for (const [sha, entry] of unlisted) {
    items.push({ sha, sourceId: entry.sourceId, representationKey: entry.representationKey,
      ...(entry.publishedAt !== undefined ? { publishedAt: entry.publishedAt } : {}),
      listed: false, failures: entry.failures });
  }
  return items;
}

/** Mark a document's signals as reached Postgres. */
export function coverRefreshDocument(
  ledger: RefreshCoverageLedger,
  sha: string,
  now: () => Date,
): RefreshCoverageLedger {
  return patch(ledger, sha, (entry) => ({ ...entry, state: "covered", failures: entry.failures }), now);
}

/**
 * Count one failed attempt, and set the document aside once it has failed too
 * often. A document refused for quality, carrying a terminal receipt or out of
 * call budget is otherwise the first pending document of its city FOR EVER: it
 * hides every older document behind it and pays primary plus fallback on every
 * rotation.
 */
export function failRefreshDocument(
  ledger: RefreshCoverageLedger,
  sha: string,
  reason: string,
  maxFailures: number,
  now: () => Date,
): { ledger: RefreshCoverageLedger; abandoned: boolean; failures: number } {
  const failures = (ledger.documents[sha]?.failures ?? 0) + 1;
  const abandoned = failures >= maxFailures;
  return {
    ledger: patch(ledger, sha, (entry) => ({ ...entry,
      state: abandoned ? "abandoned" : "pending", failures, lastReason: reason }), now),
    abandoned, failures,
  };
}

function patch(
  ledger: RefreshCoverageLedger,
  sha: string,
  mutate: (entry: RefreshCoverageEntry) => RefreshCoverageEntry,
  now: () => Date,
): RefreshCoverageLedger {
  const existing = ledger.documents[sha];
  if (!existing) throw new Error(`Unknown refresh coverage document for ${ledger.citySlug}`);
  const timestamp = now().toISOString();
  return { ...ledger, updatedAt: timestamp,
    documents: { ...ledger.documents, [sha]: { ...mutate(existing), updatedAt: timestamp } } };
}

/** Counts a sweep can report without re-reading every ledger. */
export function summarizeRefreshCoverage(ledger: RefreshCoverageLedger): Readonly<Record<RefreshCoverageState, number>> {
  const counts = { pending: 0, covered: 0, abandoned: 0 };
  for (const entry of Object.values(ledger.documents)) counts[entry.state] += 1;
  return counts;
}
