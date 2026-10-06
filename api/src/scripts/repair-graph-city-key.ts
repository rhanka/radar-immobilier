/**
 * repair-graph-city-key — GH #812: re-align every city's PG graph on its own S3
 * `graph/<city>/latest.json` after migration 0013 (spec docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md
 * §7.2). S3 is the source of truth; PG is its projection.
 *
 * Per city: ONE transaction, all or nothing — per-city lock, current rows read under
 * the lock, classification clean / foreign / unknown (`city-key-repair.ts`), refusal
 * before any mutation when a row is `unknown`, then the standard projection with the
 * rows proven to carry another city's content left out of the guard baseline.
 *
 * PREVIEW BY DEFAULT: the real code path inside a transaction that is always rolled
 * back — no persistent PG write. `--apply` commits. Never writes `latest.json` (the
 * object store refuses that key outside the guarded writer); the only S3 object
 * written is the run report `reports/graph-city-key/<run-id>/repair.json`.
 *
 * Preview over every city (`--all`) is the read-only measurement: drift of ids and
 * edges between S3 and PG, foreign / unknown rows, before verdicts (the guards a
 * plain projection meets today) and repair verdicts, for every city. The cities to
 * repair are those with `needsRepair: true` in the report (G1 excluded by owner Q3).
 *
 * Usage (compiled in the image: node dist/scripts/repair-graph-city-key.js):
 *   repair-graph-city-key --all                      # preview, every city (measurement)
 *   repair-graph-city-key gore barkmere              # preview, listed cities
 *   repair-graph-city-key --apply gore barkmere      # apply, listed cities only
 *   options: --run-id <token>  (default graph-city-key-repair-<UTC>)
 *
 * `--apply` requires explicit cities (never `--all`). Preconditions (exit 2): the
 * primary key of graph_nodes is (city_slug, id). The run-job workflow refuses to
 * start while a refresh, backup, projection, recovery, mapper or repair Job runs.
 *
 * Exit: 0 when every city passes (or is a no-op) and the report is uploaded; 1 when a city is
 * refused, errors or is unavailable (no readable latest.json), or the report upload fails;
 * 2 on a usage or precondition error.
 */
import { writeFile } from "node:fs/promises";

import { eq, sql } from "drizzle-orm";

import { loadConfig } from "../config.js";
import { createDb, type Database } from "../db/client.js";
import { graphNodes } from "../db/schema.js";
import { createLogger } from "../logger.js";
import {
  comparable,
  idsWithLostContent,
  repairCity,
  type CityRepairReport,
  type ComparableNodeRow,
} from "../services/graph/city-key-repair.js";
import { prepareCityProjection, type CityProjection } from "../services/graph/graph-store.js";
import { getScrapeObjectStore, isMissingObjectError, type S3ObjectStore } from "../storage/s3-object-store.js";

const decoder = new TextDecoder();
const TERMINATION_LOG = "/dev/termination-log";
const TERMINATION_MAX = 4000;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export interface Args {
  apply: boolean;
  all: boolean;
  cities: string[];
  runId: string;
}

export function parseArgs(argv: readonly string[]): Args | { error: string } {
  const args: Args = { apply: false, all: false, cities: [], runId: `graph-city-key-repair-${new Date().toISOString().replace(/[:.]/g, "-")}` };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--apply") args.apply = true;
    else if (arg === "--all") args.all = true;
    else if (arg === "--run-id") {
      const value = argv[++i];
      if (!value || !/^[A-Za-z0-9._-]+$/.test(value)) return { error: "--run-id needs a token [A-Za-z0-9._-]+" };
      args.runId = value;
    } else if (arg.startsWith("--")) return { error: `unknown option ${arg}` };
    else if (SLUG.test(arg)) args.cities.push(arg);
    else return { error: `invalid city slug ${JSON.stringify(arg)}` };
  }
  if (args.all && args.cities.length > 0) return { error: "--all and explicit cities are exclusive" };
  if (!args.all && args.cities.length === 0) return { error: "give city slugs or --all" };
  if (args.apply && args.all) return { error: "--apply requires explicit cities (never --all)" };
  return args;
}

/** Why a target city could not be repaired before its transaction: no object, a storage error, or a file that is not a graph. */
export interface UnavailableCity {
  city: string;
  cause: "not-found" | "read-failed" | "unreadable";
  detail: string;
}

type ProjectionRead = { projection: CityProjection } | { unavailable: UnavailableCity };

type RepairStore = Pick<S3ObjectStore, "get" | "list" | "put">;

/** The city's projection from its latest.json, or why it is unavailable (review A825-03 / SOL-825-01). */
async function readProjection(store: RepairStore, city: string): Promise<ProjectionRead> {
  let raw: Uint8Array;
  try {
    raw = await store.get(`graph/${city}/latest.json`);
  } catch (err) {
    return { unavailable: { city, cause: isMissingObjectError(err) ? "not-found" : "read-failed", detail: String(err).slice(0, 200) } };
  }
  try {
    return { projection: prepareCityProjection(city, JSON.parse(decoder.decode(raw))) };
  } catch (err) {
    return { unavailable: { city, cause: "unreadable", detail: String(err).slice(0, 200) } };
  }
}

export function summarize(
  reports: readonly CityRepairReport[],
  meta: Record<string, unknown>,
  unavailable: readonly UnavailableCity[] = [],
) {
  const by = (pred: (r: CityRepairReport) => boolean) => reports.filter(pred).map((r) => r.city);
  return {
    ...meta,
    cities: reports.length,
    noop: by((r) => r.noop && r.verdict === "pass").length,
    needsRepair: by((r) => !r.noop),
    /** Cities whose repair transaction committed (apply): the only input of the next step (R5). */
    committed: by((r) => r.applied),
    pass: by((r) => r.verdict === "pass").length,
    refusedUnknown: by((r) => r.verdict === "refused-unknown"),
    refusedGuard: by((r) => r.verdict === "refused-guard"),
    errors: by((r) => r.verdict === "error"),
    /** Target cities never attempted: no readable latest.json (counted as errors). */
    unavailable: unavailable.map((u) => `${u.city}:${u.cause}`),
    beforeRefused: by((r) => r.before.verdict === "refused"),
    foreignNodes: reports.reduce((n, r) => n + r.classes.foreign, 0),
    unknownNodes: reports.reduce((n, r) => n + r.classes.unknown, 0),
    citiesWithForeign: by((r) => r.classes.foreign > 0).length,
  };
}

type Summary = ReturnType<typeof summarize>;

/** The bounded (≤ 4 KiB) termination summary: counts, report status and the city lists, truncated. */
export function terminationSummary(
  summary: Summary,
  extra: { mode: string; runId: string; reportKey: string; reportUploaded: boolean; reportError?: string },
): string {
  for (const cap of [60, 30, 15, 5, 0]) {
    const list = (xs: readonly string[]) => (xs.length > cap ? [...xs.slice(0, cap), `…+${xs.length - cap}`] : xs);
    const body = JSON.stringify({
      ...extra,
      cities: summary.cities, pass: summary.pass, noop: summary.noop, foreignNodes: summary.foreignNodes, unknownNodes: summary.unknownNodes,
      committed: list(summary.committed), refusedUnknown: list(summary.refusedUnknown), refusedGuard: list(summary.refusedGuard),
      errors: list(summary.errors), unavailable: list(summary.unavailable), needsRepair: summary.needsRepair.length,
    });
    if (body.length <= TERMINATION_MAX) return body;
  }
  return JSON.stringify({ ...extra, truncated: true }).slice(0, TERMINATION_MAX);
}

export interface RepairDeps {
  db: Database;
  store: RepairStore;
  logger: Pick<ReturnType<typeof createLogger>, "info" | "error">;
  writeTermination: (body: string) => Promise<void>;
}

/** The repair run (see the module header). Returns the process exit code. */
export async function runRepair(args: Args, deps: RepairDeps): Promise<number> {
  const { db, store, logger } = deps;
  const mode = args.apply ? "apply" : "preview";

  const pk = await db.execute<{ cols: string[] }>(sql`
    SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum)) AS cols
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.graph_nodes'::regclass AND c.contype = 'p'`);
  const cols = pk.rows[0]?.cols ?? [];
  if (cols.join(",") !== "city_slug,id") {
    console.error(`repair-graph-city-key: precondition failed — graph_nodes primary key is (${cols.join(", ")}), expected (city_slug, id); run migration 0013 first`);
    return 2;
  }

  const allCities = ((await store.list("graph/")) ?? [])
    .filter((key) => /^graph\/[^/]+\/latest\.json$/.test(key))
    .map((key) => key.split("/")[1]!)
    .sort();
  const targets = args.all ? allCities : [...new Set(args.cities)];
  logger.info({ mode, runId: args.runId, targets: targets.length, s3Cities: allCities.length }, "repair-graph-city-key: start");

  // Phase 1 — ids of each target city whose PG content differs from its own S3 rows.
  const neededIds = new Set<string>();
  const unavailable = new Map<string, UnavailableCity>();
  for (const city of targets) {
    const read = await readProjection(store, city);
    if ("unavailable" in read) { unavailable.set(city, read.unavailable); continue; }
    const pgRows = (
      await db.select({ id: graphNodes.id, type: graphNodes.type, label: graphNodes.label, props: graphNodes.props, sourceRef: graphNodes.sourceRef })
        .from(graphNodes).where(eq(graphNodes.citySlug, city))
    ).map((row) => comparable({ ...row, props: (row.props ?? {}) as Record<string, unknown> }));
    for (const id of idsWithLostContent(pgRows, read.projection)) neededIds.add(id);
  }

  // Phase 2 — same-id rows of every city's S3 file, kept only for those ids. A file that cannot be
  // read here only removes candidates: affected rows become `unknown` (refused), never `foreign`.
  const foreignIndex = new Map<string, Array<{ city: string; row: ComparableNodeRow }>>();
  if (neededIds.size > 0) {
    for (const city of allCities) {
      const read = await readProjection(store, city);
      if ("unavailable" in read) continue;
      for (const row of read.projection.nodeRows) {
        if (!neededIds.has(row.id)) continue;
        const list = foreignIndex.get(row.id) ?? [];
        list.push({ city, row: comparable(row) });
        foreignIndex.set(row.id, list);
      }
    }
  }
  logger.info({ neededIds: neededIds.size, indexedIds: foreignIndex.size }, "repair-graph-city-key: foreign index built");

  // Phase 3 — one transaction per city (rolled back in preview).
  const reports: CityRepairReport[] = [];
  for (const city of targets) {
    if (unavailable.has(city)) continue;
    const read = await readProjection(store, city);
    if ("unavailable" in read) { unavailable.set(city, read.unavailable); continue; }
    const report = await repairCity(db, read.projection, foreignIndex, mode);
    reports.push(report);
    console.log(JSON.stringify({ event: "repair-graph-city-key:city", ...report,
      foreignNodes: report.foreignNodes.slice(0, 50), unknownNodes: report.unknownNodes.slice(0, 50) }));
  }
  for (const u of unavailable.values()) console.log(JSON.stringify({ event: "repair-graph-city-key:unavailable", ...u }));

  const summary = summarize(reports, { event: "repair-graph-city-key:report", mode, runId: args.runId }, [...unavailable.values()]);
  const reportKey = `reports/graph-city-key/${args.runId}/repair.json`;
  let reportUploaded = true;
  let reportError: string | undefined;
  try {
    await store.put(reportKey, JSON.stringify({ summary, reports, unavailable: [...unavailable.values()] }, null, 2), "application/json");
  } catch (err) {
    // SOL-825-02: the report is the only durable per-city record; a failed upload fails the run.
    reportUploaded = false;
    reportError = String(err).slice(0, 200);
    logger.error({ reportKey, err: reportError }, "repair-graph-city-key: report upload failed");
  }
  console.log(JSON.stringify({ ...summary, reportKey, reportUploaded }));
  await deps.writeTermination(terminationSummary(summary, { mode, runId: args.runId, reportKey, reportUploaded, ...(reportError ? { reportError } : {}) }));

  const failures = summary.refusedUnknown.length + summary.refusedGuard.length + summary.errors.length + unavailable.size;
  return failures > 0 || !reportUploaded ? 1 : 0;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`repair-graph-city-key: ${parsed.error}`);
    return 2;
  }
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  // Same store as recover-document-dates (graph snapshots live in the docs bucket, SCRAPE binding).
  const store = getScrapeObjectStore(config);
  const { db, pool } = createDb(config);
  try {
    return await runRepair(parsed, {
      db,
      store,
      logger,
      writeTermination: (body) => writeFile(TERMINATION_LOG, body).catch(() => undefined),
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && /repair-graph-city-key\.(ts|js)$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("repair-graph-city-key: fatal", err);
      process.exit(1);
    },
  );
}
