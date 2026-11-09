/**
 * OPERATOR REQUEUE of `abandoned` refresh-coverage documents.
 *
 * All ledger reads/writes go through `refresh-coverage.ts` (`readRefreshCoverage`,
 * `requeueAbandonedRefreshDocuments`, `writeRefreshCoverage`): this module only
 * orchestrates cities, filters, the dry-run and the audit trace. It never
 * edits a ledger by hand and never touches any other key.
 *
 * P1-1 safety: before the first rewrite of a city, the original object bytes
 * are copied to `refresh/018/_backup/requeue-abandoned-<stamp>/<city>/coverage.json`.
 * The audit trace is rewritten in S3 as the loop goes: an `intent` entry is
 * durable before each rewrite, then replaced by the per-city result. Restore
 * (`runRefreshRequeueRestore`) recopies a backup byte for byte over the live
 * registry; running it twice has the same effect as running it once.
 */

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
  /** Dated backup of the original object, or null when nothing was rewritten. */
  readonly backupKey?: string | null;
  /** `intent` is durable before the rewrite; `done` replaces it after. */
  readonly phase?: "intent" | "done" | "skipped";
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
  readonly backupPrefix?: string | null;
  /** False on the progressive traces written during the loop. */
  readonly complete?: boolean;
}

export function refreshRequeueStamp(when: Date): string {
  return when.toISOString().replace(/[:.]/g, "-");
}

/** Audit records live next to the per-city registries they describe. */
export function refreshRequeueAuditKey(when: Date): string {
  return `refresh/018/_audit/requeue-abandoned-${refreshRequeueStamp(when)}.json`;
}

export function refreshRequeueBackupPrefix(when: Date): string {
  return `refresh/018/_backup/requeue-abandoned-${refreshRequeueStamp(when)}`;
}

export function refreshRequeueBackupKey(when: Date, citySlug: string): string {
  return `${refreshRequeueBackupPrefix(when)}/${citySlug}/coverage.json`;
}

const COVERAGE_KEY = /^refresh\/018\/([^/]+)\/coverage\.json$/;
const BACKUP_KEY = /^refresh\/018\/_backup\/requeue-abandoned-[^/]+\/([^/]+)\/coverage\.json$/;
const STAMP = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CITY_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export async function discoverRefreshCoverageCities(store: ObjectStore): Promise<string[]> {
  if (!store.list) throw new Error("object store does not support listing coverage registries");
  const keys = await store.list("refresh/018/");
  const cities = new Set<string>();
  for (const key of keys) {
    const match = COVERAGE_KEY.exec(key);
    if (match && !key.startsWith("refresh/018/_backup/")) cities.add(match[1]!);
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
  const auditKey = options.dryRun ? null : refreshRequeueAuditKey(when);
  const backupPrefix = options.dryRun ? null : refreshRequeueBackupPrefix(when);
  const cityTraces: RefreshRequeueCityTrace[] = [];
  let requeuedTotal = 0;
  let skipped = 0;
  const snapshot = (complete: boolean): RefreshRequeueTrace => ({
    schemaVersion: 1, kind: "refresh-requeue-abandoned",
    who: options.who, when: when.toISOString(), dryRun: options.dryRun,
    since: options.since?.toISOString() ?? null, cities: [...cityTraces],
    totals: { cities: cities.length, requeued: requeuedTotal, skipped },
    auditKey, backupPrefix, complete,
  });
  const persist = async (complete: boolean): Promise<void> => {
    if (auditKey) await store.put(auditKey, JSON.stringify(snapshot(complete)), "application/json");
  };
  for (const citySlug of cities) {
    const { ledger, unreadable } = await readRefreshCoverage(store, citySlug);
    if (!ledger) {
      skipped += 1;
      cityTraces.push({ citySlug, requeued: [], countsBefore: {}, backupKey: null,
        phase: "skipped", skipped: unreadable ? "unreadable" : "absent" });
      await persist(false);
      continue;
    }
    const countsBefore = summarizeRefreshCoverage(ledger);
    const result = requeueAbandonedRefreshDocuments(ledger, {
      ...(options.since ? { since: options.since } : {}), now });
    if (!result.changed || options.dryRun) {
      if (result.changed) requeuedTotal += result.requeued.length;
      cityTraces.push({ citySlug, requeued: result.requeued, countsBefore,
        backupKey: null, phase: "done" });
      await persist(false);
      continue;
    }
    // Backup BEFORE the first rewrite, byte for byte from the live object.
    const backupKey = refreshRequeueBackupKey(when, citySlug);
    const original = await store.get(refreshCoverageKey(citySlug));
    await store.put(backupKey, original, "application/json");
    const intent: RefreshRequeueCityTrace = { citySlug, requeued: result.requeued,
      countsBefore, backupKey, phase: "intent" };
    cityTraces.push(intent);
    await persist(false);
    await writeRefreshCoverage(store, result.ledger);
    requeuedTotal += result.requeued.length;
    cityTraces[cityTraces.indexOf(intent)] = { ...intent, phase: "done" };
    await persist(false);
  }
  const trace = snapshot(true);
  if (auditKey) await store.put(auditKey, JSON.stringify(trace), "application/json");
  return trace;
}

/* --- Restore ------------------------------------------------------------- */

export interface RefreshRequeueRestoreCityTrace {
  readonly citySlug: string;
  readonly backupKey: string;
  readonly phase: "intent" | "done" | "skipped";
  readonly skipped?: "absent";
}

export interface RefreshRequeueRestoreTrace {
  readonly schemaVersion: 1;
  readonly kind: "refresh-requeue-restore";
  readonly who: string;
  readonly when: string;
  readonly dryRun: boolean;
  /** Backup stamp being restored (the `<stamp>` of the backup prefix). */
  readonly stamp: string;
  readonly cities: readonly RefreshRequeueRestoreCityTrace[];
  readonly totals: { readonly cities: number; readonly restored: number; readonly skipped: number };
  readonly auditKey: string | null;
  readonly complete?: boolean;
}

export function refreshRequeueRestoreAuditKey(when: Date): string {
  return `refresh/018/_audit/requeue-restore-${refreshRequeueStamp(when)}.json`;
}

export interface RunRefreshRequeueRestoreOptions {
  readonly who: string;
  readonly dryRun: boolean;
  readonly stamp: string;
  readonly cities?: readonly string[];
  readonly now?: () => Date;
}

export async function discoverRefreshRequeueBackupCities(
  store: ObjectStore, stamp: string,
): Promise<string[]> {
  if (!store.list) throw new Error("object store does not support listing coverage backups");
  const keys = await store.list(`refresh/018/_backup/requeue-abandoned-${stamp}/`);
  const cities = new Set<string>();
  for (const key of keys) {
    const match = BACKUP_KEY.exec(key);
    if (match) cities.add(match[1]!);
  }
  return [...cities].sort();
}

/**
 * Restore: recopy each backup object byte for byte over the live registry.
 * Idempotent: the backup is never modified, so a second run recopies the
 * same bytes. Absent backups are skipped, never invented.
 */
export async function runRefreshRequeueRestore(
  store: ObjectStore,
  options: RunRefreshRequeueRestoreOptions,
): Promise<RefreshRequeueRestoreTrace> {
  if (!STAMP.test(options.stamp) || options.stamp.includes("..")) {
    throw new Error(`invalid restore stamp: ${options.stamp}`);
  }
  const now = options.now ?? (() => new Date());
  const when = now();
  let cities: string[];
  if (options.cities?.length) {
    cities = [...new Set(options.cities)].sort();
    for (const city of cities) {
      if (!CITY_SLUG.test(city)) throw new Error(`invalid city slug: ${city}`);
    }
  } else {
    cities = await discoverRefreshRequeueBackupCities(store, options.stamp);
  }
  const auditKey = options.dryRun ? null : refreshRequeueRestoreAuditKey(when);
  const cityTraces: RefreshRequeueRestoreCityTrace[] = [];
  let restored = 0;
  let skipped = 0;
  const snapshot = (complete: boolean): RefreshRequeueRestoreTrace => ({
    schemaVersion: 1, kind: "refresh-requeue-restore",
    who: options.who, when: when.toISOString(), dryRun: options.dryRun,
    stamp: options.stamp, cities: [...cityTraces],
    totals: { cities: cities.length, restored, skipped }, auditKey, complete,
  });
  const persist = async (complete: boolean): Promise<void> => {
    if (auditKey) await store.put(auditKey, JSON.stringify(snapshot(complete)), "application/json");
  };
  for (const citySlug of cities) {
    const backupKey = `refresh/018/_backup/requeue-abandoned-${options.stamp}/${citySlug}/coverage.json`;
    if (!(await store.head(backupKey))) {
      skipped += 1;
      cityTraces.push({ citySlug, backupKey, phase: "skipped", skipped: "absent" });
      await persist(false);
      continue;
    }
    if (options.dryRun) {
      restored += 1;
      cityTraces.push({ citySlug, backupKey, phase: "done" });
      continue;
    }
    const intent: RefreshRequeueRestoreCityTrace = { citySlug, backupKey, phase: "intent" };
    cityTraces.push(intent);
    await persist(false);
    const bytes = await store.get(backupKey);
    await store.put(refreshCoverageKey(citySlug), bytes, "application/json");
    restored += 1;
    cityTraces[cityTraces.indexOf(intent)] = { ...intent, phase: "done" };
    await persist(false);
  }
  const trace = snapshot(true);
  if (auditKey) await store.put(auditKey, JSON.stringify(trace), "application/json");
  return trace;
}

export { refreshCoverageKey };
