/**
 * OPERATOR REQUEUE of `abandoned` refresh-coverage documents.
 *
 * All ledger reads/writes go through `refresh-coverage.ts` (`readRefreshCoverage`,
 * `requeueAbandonedRefreshDocuments`, `writeRefreshCoverage`): this module only
 * orchestrates cities, filters, the dry-run and the audit trace. It never
 * edits a ledger by hand and never touches any other key.
 */

import { createHash } from "node:crypto";

import type { ObjectStore } from "../../storage/object-store.js";
import {
  readRefreshCoverage,
  refreshCoverageKey,
  requeueAbandonedRefreshDocuments,
  summarizeRefreshCoverage,
  writeRefreshCoverage,
} from "./refresh-coverage.js";

export interface RefreshRequeueCityTrace {
  readonly citySlug: string;
  /** sha256 of every document requeued in this city (sorted). */
  readonly requeued: readonly string[];
  readonly countsBefore: Readonly<Record<string, number>>;
  /** Set when the city was skipped without any write. */
  readonly skipped?: "absent" | "unreadable";
}

export interface RefreshRequeueTrace {
  readonly schemaVersion: 1;
  readonly kind: "refresh-requeue-abandoned";
  /** Operator identity (`--operator` / `REQUEUE_OPERATOR`), never a secret. */
  readonly who: string;
  readonly when: string;
  readonly dryRun: boolean;
  readonly since: string | null;
  readonly cities: readonly RefreshRequeueCityTrace[];
  readonly totals: { readonly cities: number; readonly requeued: number; readonly skipped: number };
  /** Audit object key in the same store, or null on a dry run (no writes). */
  readonly auditKey: string | null;
}

/** Audit records live next to the per-city registries they describe. */
export function refreshRequeueAuditKey(when: Date, traceSha256: string): string {
  const stamp = when.toISOString().replace(/[:.]/g, "-");
  return `refresh/018/_audit/requeue-abandoned-${stamp}-${traceSha256.slice(0, 12)}.json`;
}

const COVERAGE_KEY = /^refresh\/018\/([^/]+)\/coverage\.json$/;

export async function discoverRefreshCoverageCities(store: ObjectStore): Promise<string[]> {
  if (!store.list) throw new Error("object store does not support listing coverage registries");
  const keys = await store.list("refresh/018/");
  const cities = new Set<string>();
  for (const key of keys) {
    const match = COVERAGE_KEY.exec(key);
    if (match) cities.add(match[1]!);
  }
  return [...cities].sort();
}

export interface RunRefreshRequeueOptions {
  readonly who: string;
  readonly dryRun: boolean;
  readonly since?: Date;
  /** Explicit city filter; absent means every city holding a registry. */
  readonly cities?: readonly string[];
  readonly now?: () => Date;
}

export async function runRefreshRequeueAbandoned(
  store: ObjectStore,
  options: RunRefreshRequeueOptions,
): Promise<RefreshRequeueTrace> {
  const now = options.now ?? (() => new Date());
  const when = now();
  const cities = options.cities?.length
    ? [...new Set(options.cities)].sort()
    : await discoverRefreshCoverageCities(store);
  const cityTraces: RefreshRequeueCityTrace[] = [];
  let requeuedTotal = 0;
  let skipped = 0;
  for (const citySlug of cities) {
    const { ledger, unreadable } = await readRefreshCoverage(store, citySlug);
    if (!ledger) {
      skipped += 1;
      cityTraces.push({ citySlug, requeued: [], countsBefore: {},
        skipped: unreadable ? "unreadable" : "absent" });
      continue;
    }
    const countsBefore = summarizeRefreshCoverage(ledger);
    const result = requeueAbandonedRefreshDocuments(ledger, {
      ...(options.since ? { since: options.since } : {}), now });
    if (result.changed && !options.dryRun) await writeRefreshCoverage(store, result.ledger);
    requeuedTotal += result.requeued.length;
    cityTraces.push({ citySlug, requeued: result.requeued, countsBefore });
  }
  const base = {
    schemaVersion: 1 as const, kind: "refresh-requeue-abandoned" as const,
    who: options.who, when: when.toISOString(), dryRun: options.dryRun,
    since: options.since?.toISOString() ?? null, cities: cityTraces,
    totals: { cities: cities.length, requeued: requeuedTotal, skipped },
  };
  if (options.dryRun) return { ...base, auditKey: null };
  const traceSha = createHash("sha256").update(JSON.stringify(base)).digest("hex");
  const auditKey = refreshRequeueAuditKey(when, traceSha);
  const trace: RefreshRequeueTrace = { ...base, auditKey };
  await store.put(auditKey, JSON.stringify(trace), "application/json");
  return trace;
}

export { refreshCoverageKey };
