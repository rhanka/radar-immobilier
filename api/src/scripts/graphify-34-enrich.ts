/**
 * Graphify 3.4 Phase A producer.
 *
 * The input is the existing Postgres graph projection, never raw documents.
 * The output is a complete city snapshot plus a deterministic manifest. The
 * command is dry-run by default; `--apply` is required before it writes S3 or
 * projects the snapshot back to Postgres.
 *
 * Usage:
 *   tsx src/scripts/graphify-34-enrich.ts city-slug
 *   tsx src/scripts/graphify-34-enrich.ts --apply city-slug
 */

import { loadConfig, resolveGraphS3Config } from "../config.js";
import { createDb } from "../db/client.js";
import { createLogger } from "../logger.js";
import { subgraphForCity, upsertGraphAtomic } from "../services/graph/graph-store.js";
import { enrichGraphify34Snapshot } from "../services/graph/graphify-34-enrichment.js";
import {
  applyGraphify34Snapshots,
  buildGraphify34Manifest,
  snapshotFromExistingCity,
  type Graphify34SnapshotTarget,
} from "../services/graph/graphify-34-snapshot.js";
import { createScrapeS3Client, S3ObjectStore } from "../storage/s3-object-store.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const cities = args.filter((arg) => arg !== "--apply");
  if (cities.length === 0) {
    throw new Error("graphify-34-enrich requires at least one city slug");
  }

  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const { db, pool } = createDb(config);
  const graphS3Config = resolveGraphS3Config(config);
  const store = new S3ObjectStore(
    createScrapeS3Client(graphS3Config),
    graphS3Config.bucket,
  );

  try {
    const targets: Graphify34SnapshotTarget[] = [];
    for (const city of cities) {
      const existing = await subgraphForCity(db, city);
      if (existing.nodes.length === 0) {
        throw new Error(`no existing graph_nodes snapshot for ${city}`);
      }

      const base = snapshotFromExistingCity(existing);
      const { snapshot, stats } = enrichGraphify34Snapshot(base, city);
      const manifest = buildGraphify34Manifest(city, snapshot);
      const summary = { city, apply, stats, manifest };
      logger.info(summary, "graphify-34-enrich: complete-city snapshot prepared");
      targets.push({ municipality: city, snapshot, manifest });
    }
    if (!apply) return;

    const backupId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
    logger.info(
      { backupId, cities: targets.map((target) => target.municipality) },
      "graphify-34-enrich: starting required pre-apply S3 backup",
    );
    const backups = await applyGraphify34Snapshots(store, targets, backupId, async (target) => {
      const result = await upsertGraphAtomic(db, target.municipality, target.snapshot);
      if (result.aborted) {
        throw new Error(
          `projection refused for ${target.municipality}: ${result.reason ?? "unknown reason"}`,
        );
      }
      logger.info(
        {
          city: target.municipality,
          nodeCount: result.nodeCount,
          edgeCount: result.edgeCount,
        },
        "graphify-34-enrich: snapshot projected",
      );
    });
    logger.info({ backupId, backups }, "graphify-34-enrich: pre-apply S3 backup complete");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
