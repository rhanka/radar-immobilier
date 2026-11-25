/**
 * refresh-requeue-abandoned — operator requeue of `abandoned` coverage entries.
 *
 * Usage:
 *   node dist/scripts/refresh-requeue-abandoned.js --dry-run [--since <date>] [--reason <list>] [--availability-only] [--city <slug>]...
 *   node dist/scripts/refresh-requeue-abandoned.js --operator <who> [--since <date>] [--reason <list>] [--availability-only] [--city <slug>]...
 *   node dist/scripts/refresh-requeue-abandoned.js --operator <who> --restore <stamp> [--city <slug>]...
 *
 * Filtering by `lastReason`:
 *   - `--availability-only` (or `--reason availability`) matches all model
 *     availability reasons (`REFRESH_AVAILABILITY_REASONS`).
 *   - `--reason transport` (or `--reason availability,transport`) explicitly
 *     targets documents abandoned before #1177, when `RoutePlanError no-route`
 *     after cooldown was misclassified as `lastReason: "transport"`. Documents
 *     abandoned on `quality` or other reasons stay untouched.
 *
 * Restore procedure: a real requeue first copies each original registry to
 * `refresh/018/_backup/requeue-abandoned-<stamp>/<city>/coverage.json` (the
 * stamp and per-city `backupKey` are in the audit trace). To roll back, run
 * `--restore <stamp>` (optionally `--city <slug>`, repeatable): it recopies
 * each backup byte for byte over `refresh/018/<city>/coverage.json`, under
 * the same flock as a requeue, and is idempotent. `--dry-run --restore
 * <stamp>` only reports what would be restored.
 *
 * Requeues `abandoned` -> `pending` (failures 0, `lastReason` removed) through
 * `services/graph/refresh-coverage.ts` only. `--dry-run` writes nothing and
 * prints counts per city. A real run prints a JSON trace (who, when, cities,
 * shas) to stdout and stores the same trace next to the registries at
 * `refresh/018/_audit/requeue-abandoned-*.json`.
 *
 * Concurrency: run under the SAME flock as a refresh pass
 * (`flock -n /keyring/runtime/.refresh.lock`, as the CronJob does).
 * `flock -n` exits non-zero while a pass holds the lock, so the run is
 * refused instead of racing a registry rewrite. The one-off Job in
 * `deploy/k8s/refresh-cronjobs/requeue-abandoned/` wires exactly that.
 */

import { loadConfig } from "../config.js";
import { REFRESH_AVAILABILITY_REASONS } from "../services/graph/refresh-coverage.js";
import {
  runRefreshRequeueAbandoned, runRefreshRequeueRestore,
  type RefreshRequeueTrace,
} from "../services/graph/refresh-requeue.js";
import { getScrapeObjectStore } from "../storage/s3-object-store.js";

const REASON_TOKEN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Expand CLI/env reason tokens, turning the `availability` alias into the full
 * set of model-availability reasons. Returns sorted unique tokens.
 */
export function expandRequeueReasons(raw: readonly string[]): string[] {
  const expanded = new Set<string>();
  for (const item of raw) {
    for (const part of item.split(",")) {
      const token = part.trim();
      if (!token) continue;
      if (!REASON_TOKEN.test(token)) throw new Error(`invalid reason: ${token}`);
      if (token === "availability") {
        for (const reason of REFRESH_AVAILABILITY_REASONS) expanded.add(reason);
      } else {
        expanded.add(token);
      }
    }
  }
  return [...expanded].sort();
}

export interface RefreshRequeueArgs {
  readonly dryRun: boolean;
  readonly since?: Date;
  readonly cities: string[];
  readonly reasons?: readonly string[];
  readonly operator?: string;
  readonly restore?: string;
}

export function parseRefreshRequeueArgs(argv: readonly string[]): RefreshRequeueArgs {
  let dryRun = false;
  let since: Date | undefined;
  let operator: string | undefined;
  let restore: string | undefined;
  const cities: string[] = [];
  const rawReasons: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--since") {
      const raw = next();
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw new Error(`--since is not a valid date: ${raw}`);
      since = parsed;
    } else if (arg === "--city") {
      for (const slug of next().split(",")) if (slug.trim()) cities.push(slug.trim());
    } else if (arg === "--reason") {
      rawReasons.push(next());
    } else if (arg === "--availability-only") {
      rawReasons.push("availability");
    } else if (arg === "--operator") operator = next();
    else if (arg === "--restore") restore = next();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (restore !== undefined && since) throw new Error("--restore cannot be combined with --since");
  if (restore !== undefined && rawReasons.length > 0) {
    throw new Error("--restore cannot be combined with --reason or --availability-only");
  }
  const reasons = rawReasons.length > 0 ? expandRequeueReasons(rawReasons) : undefined;
  return { dryRun, ...(since ? { since } : {}), cities,
    ...(reasons?.length ? { reasons } : {}),
    ...(operator ? { operator } : {}), ...(restore ? { restore } : {}) };
}

export function formatDryRunCounts(trace: RefreshRequeueTrace): string {
  const lines = trace.cities.map((city) =>
    `${city.citySlug}\t${city.skipped ?? `would-requeue=${city.requeued.length}`}`);
  lines.push(`total\tcities=${trace.totals.cities}\twould-requeue=${trace.totals.requeued}\tskipped=${trace.totals.skipped}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseRefreshRequeueArgs(process.argv.slice(2));
  const who = args.operator ?? process.env.REQUEUE_OPERATOR ?? process.env.OPERATOR ?? "";
  if (!args.dryRun && !who) throw new Error("--operator <who> (or REQUEUE_OPERATOR) is required for a real run");
  const store = getScrapeObjectStore(loadConfig());
  if (args.restore) {
    const restoreTrace = await runRefreshRequeueRestore(store, {
      who: who || "dry-run", dryRun: args.dryRun, stamp: args.restore,
      ...(args.cities.length ? { cities: args.cities } : {}),
    });
    console.log(JSON.stringify(restoreTrace));
    return;
  }
  const trace = await runRefreshRequeueAbandoned(store, {
    who: who || "dry-run", dryRun: args.dryRun,
    ...(args.since ? { since: args.since } : {}),
    ...(args.cities.length ? { cities: args.cities } : {}),
    ...(args.reasons?.length ? { reasons: args.reasons } : {}),
  });
  if (args.dryRun) console.log(formatDryRunCounts(trace));
  console.log(JSON.stringify(trace));
}

const isMain = process.argv[1]?.endsWith("refresh-requeue-abandoned.js")
  || process.argv[1]?.endsWith("refresh-requeue-abandoned.ts")
  || process.argv[1]?.endsWith("requeue-abandoned.bundle.mjs");
if (isMain) {
  main().catch((error: unknown) => {
    console.error("refresh-requeue-abandoned: failed", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
