/**
 * refresh-requeue-abandoned — operator requeue of `abandoned` coverage entries.
 *
 * Usage:
 *   node dist/scripts/refresh-requeue-abandoned.js --dry-run [--since <date>] [--city <slug>]...
 *   node dist/scripts/refresh-requeue-abandoned.js --operator <who> [--since <date>] [--city <slug>]...
 *   node dist/scripts/refresh-requeue-abandoned.js --operator <who> --restore <stamp> [--city <slug>]...
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
import {
  runRefreshRequeueAbandoned, runRefreshRequeueRestore,
  type RefreshRequeueTrace,
} from "../services/graph/refresh-requeue.js";
import { getScrapeObjectStore } from "../storage/s3-object-store.js";

export interface RefreshRequeueArgs {
  readonly dryRun: boolean;
  readonly since?: Date;
  readonly cities: string[];
  readonly operator?: string;
  readonly restore?: string;
}

export function parseRefreshRequeueArgs(argv: readonly string[]): RefreshRequeueArgs {
  let dryRun = false;
  let since: Date | undefined;
  let operator: string | undefined;
  let restore: string | undefined;
  const cities: string[] = [];
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
    } else if (arg === "--operator") operator = next();
    else if (arg === "--restore") restore = next();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (restore !== undefined && since) throw new Error("--restore cannot be combined with --since");
  return { dryRun, ...(since ? { since } : {}), cities,
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
