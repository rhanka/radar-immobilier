/**
 * recover-document-dates — stock recovery of documentary dates on served graph refs.
 *
 * Context: the shared date rule (`matchesDocumentDateWindow`) reads dates carried by the
 * persisted refs of each signal (`documentDate`/`publishedAt` for the document clock,
 * `fetchedAt` for the scrape clock). Graphs published before #788/#791 carry refs with only
 * `page, docSha, rawRef, excerpt, sourceUrl`, so a bounded period hides them. The raw sidecar
 * `<rawRef>.meta.json` already knows `fetchedAt` (always) and, when available, the documentary
 * date with its provenance. This job projects them onto the refs. No model call.
 *
 * Mechanism (same writer pattern as purge-avis-bylaws / filet-auto-link-pv): per city
 * `readCanonicalCityGraph` → `planGraphDocumentDateRecovery` (never overwrites a value already
 * on a ref, reports conflicts) → APPLY only: `archiveCityGraphPrefix` (rollback) →
 * `writeCanonicalCityGraph` (guarded by the read anchor) → `upsertGraphAtomic` (S3+PG lockstep).
 *
 * Safety:
 *  - dry-run (preview) by default; `--apply` to write;
 *  - idempotent: a second run finds nothing to add;
 *  - drift guard: when `graph/<city>/latest.json` and PG do not hold the same node ids, the city
 *    is HALTED in apply mode (writing would also re-project a different graph). `--heal` reads
 *    the served PG graph instead (same option as purge-avis-bylaws).
 *  - the refresh coverage ledger (not the graph bytes) decides what is re-extracted, so a
 *    rewritten latest.json does not re-queue documents for model calls.
 *
 * Usage: node dist/scripts/recover-document-dates.js [--apply] [--heal] [<city…>]
 * Output: one JSON line per city (`recover-document-dates:city`) and a final JSON report line
 * (`recover-document-dates:report`) on stdout.
 */
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createDb } from "../db/client.js";
import { getScrapeObjectStore } from "../storage/s3-object-store.js";
import {
  archiveCityGraphPrefix,
  captureCanonicalReadAnchor,
  readCanonicalCityGraph,
  writeCanonicalCityGraph,
  type CanonicalGraphStore,
  type CanonicalReadAnchor,
} from "../services/graph/canonical-graph-writer.js";
import { subgraphForCity, upsertGraphAtomic } from "../services/graph/graph-store.js";
import { snapshotFromExistingCity } from "../services/graph/graphify-34-snapshot.js";
import { loadDocumentMetadata, type DocumentMetadata } from "../services/sources/document-resolver.js";
import {
  addRecoveryStats,
  collectGraphRawRefs,
  emptyRecoveryStats,
  planGraphDocumentDateRecovery,
  type DocumentDateRecoveryStats,
} from "../services/sources/document-date-recovery.js";
import type { ObjectReader } from "../storage/object-store.js";

const METADATA_CONCURRENCY = 16;

/** Memoized sidecar reader; a read fault degrades that document to "no metadata" and is counted. */
export function createMetadataCache(store: ObjectReader) {
  const cache = new Map<string, Promise<DocumentMetadata | null>>();
  let readErrors = 0;
  const lookup = (rawRef: string) => {
    let pending = cache.get(rawRef);
    if (!pending) {
      pending = loadDocumentMetadata(store, rawRef).catch(() => { readErrors += 1; return null; });
      cache.set(rawRef, pending);
    }
    return pending;
  };
  return {
    lookup,
    async prefetch(rawRefs: readonly string[]) {
      for (let index = 0; index < rawRefs.length; index += METADATA_CONCURRENCY) {
        await Promise.all(rawRefs.slice(index, index + METADATA_CONCURRENCY).map(lookup));
      }
    },
    get readErrors() { return readErrors; },
  };
}

function nodeIds(graph: Record<string, unknown>): Set<string> {
  const nodes = Array.isArray(graph["nodes"]) ? graph["nodes"] as Record<string, unknown>[] : [];
  return new Set(nodes.flatMap((node) => typeof node["id"] === "string" ? [node["id"]] : []));
}

async function listCities(store: CanonicalGraphStore): Promise<string[]> {
  const keys = await store.list("graph/");
  return [...new Set(keys.flatMap((key) => {
    const match = /^graph\/([^/]+)\/latest\.json$/.exec(key);
    return match?.[1] ? [match[1]] : [];
  }))].sort();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const heal = args.includes("--heal");
  const requested = args.filter((arg) => !arg.startsWith("--"));

  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  // Same store as the refresh writer: graph snapshots and raw sidecars share the docs bucket.
  const store = getScrapeObjectStore(config);
  const { db, pool } = createDb(config);
  const metadata = createMetadataCache(store);
  const backupId = `recover-document-dates-${new Date().toISOString().replaceAll(":", "-").replace(".", "-")}`;
  const cities = requested.length > 0 ? requested : await listCities(store);
  const mode = apply ? "APPLY" : "DRY-RUN";
  logger.info({ mode, heal, cities: cities.length, source: heal ? "PG (--heal)" : "S3 latest.json" },
    "recover-document-dates: start");

  const totals: DocumentDateRecoveryStats = emptyRecoveryStats();
  const report = { mode, heal, cities: cities.length, citiesChanged: 0, citiesWritten: 0, citiesSkipped: 0,
    citiesDrift: 0, citiesHalted: 0, citiesAborted: 0, metadataReadErrors: 0, conflictSamples: [] as unknown[],
    totals };

  for (const city of cities) {
    let graph: Record<string, unknown>;
    let readAnchor: CanonicalReadAnchor;
    let pgIds: Set<string>;
    try {
      const existing = await subgraphForCity(db, city);
      pgIds = new Set(existing.nodes.map((node) => node.id));
      if (heal) {
        if (existing.nodes.length === 0) { report.citiesSkipped += 1; continue; }
        readAnchor = await captureCanonicalReadAnchor(store, city);
        graph = snapshotFromExistingCity(existing) as unknown as Record<string, unknown>;
      } else {
        const read = await readCanonicalCityGraph(store, city);
        if (!read) { report.citiesSkipped += 1; logger.warn({ city }, "recover: latest.json absent, skipped"); continue; }
        graph = JSON.parse(new TextDecoder().decode(read.body)) as Record<string, unknown>;
        readAnchor = read.anchor;
      }
    } catch (error) {
      report.citiesSkipped += 1;
      logger.warn({ city, err: String(error) }, "recover: graph unreadable, skipped");
      continue;
    }

    const graphIds = nodeIds(graph);
    const drift = !heal && (graphIds.size !== pgIds.size || [...graphIds].some((id) => !pgIds.has(id)));
    if (drift) report.citiesDrift += 1;

    await metadata.prefetch(collectGraphRawRefs(graph));
    const plan = await planGraphDocumentDateRecovery(graph, metadata.lookup);
    addRecoveryStats(totals, plan.stats);
    if (report.conflictSamples.length < 20) report.conflictSamples.push(...plan.conflicts.slice(0, 20 - report.conflictSamples.length).map((c) => ({ city, ...c })));
    if (plan.changed) report.citiesChanged += 1;
    console.log(JSON.stringify({ event: "recover-document-dates:city", city, mode, changed: plan.changed,
      drift, ...plan.stats }));

    if (!apply || !plan.changed) continue;
    if (drift) {
      report.citiesHalted += 1;
      logger.error({ city, latestNodes: graphIds.size, pgNodes: pgIds.size },
        "recover: HALT — latest.json and PG node sets differ; nothing written (rerun with --heal to recover from PG)");
      continue;
    }
    const body = new TextEncoder().encode(JSON.stringify(plan.nextGraph, null, 2));
    const archive = await archiveCityGraphPrefix(store, city, backupId);
    await writeCanonicalCityGraph(store, { citySlug: city, body, archive, readAnchor });
    const result = await upsertGraphAtomic(db, city, plan.nextGraph);
    if (result.aborted) {
      report.citiesAborted += 1;
      logger.error({ city, reason: result.reason }, "recover: PG projection aborted (latest.json written; investigate)");
    } else {
      report.citiesWritten += 1;
      logger.info({ city, backupPrefix: archive.backup_prefix, nodes: result.nodeCount }, "recover: written (S3 + PG)");
    }
  }

  report.metadataReadErrors = metadata.readErrors;
  console.log(JSON.stringify({ event: "recover-document-dates:report", ...report }));
  await pool.end();
  process.exit(report.citiesHalted > 0 || report.citiesAborted > 0 ? 1 : 0);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("recover-document-dates: fatal", error);
    process.exit(1);
  });
}
