/**
 * Graphify 3.4 Phase A producer.
 *
 * The input is the existing Postgres graph projection, never raw documents.
 * The output is a complete city snapshot plus a deterministic manifest. The
 * command is dry-run by default; `--apply` is required before it writes S3 or
 * projects the snapshot back to Postgres.
 *
 * `--apply` is not atomic — S3 has no multi-key transaction — but it is
 * RESUMABLE: every city is archived before anything is written, and a city
 * that completed leaves an `_applied/<city>.json` marker. If a run is
 * interrupted, it prints the applied cities, the one city that may be
 * half-written with the archive prefix to restore it from, and the exact
 * `--resume` command to finish.
 *
 * Usage:
 *   tsx src/scripts/graphify-34-enrich.ts city-slug
 *   tsx src/scripts/graphify-34-enrich.ts --apply city-slug
 *   tsx src/scripts/graphify-34-enrich.ts --apply --backup-id=<id> --resume city-slug
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
  const resume = args.includes("--resume");
  const backupIdArg = args.find((arg) => arg.startsWith("--backup-id="))?.slice("--backup-id=".length);
  const cities = args.filter((arg) => !arg.startsWith("--"));
  if (cities.length === 0) {
    throw new Error("graphify-34-enrich requires at least one city slug");
  }
  if (resume && !backupIdArg) {
    throw new Error("--resume requires --backup-id=<id> of the interrupted run");
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

    const backupId = backupIdArg
      ?? new Date().toISOString().replaceAll(":", "-").replace(".", "-");
    logger.info(
      { backupId, resume, cities: targets.map((target) => target.municipality) },
      "graphify-34-enrich: starting required pre-apply S3 backup",
    );
    const report = await applyGraphify34Snapshots(
      store,
      targets,
      backupId,
      async (target) => {
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
      },
      { resume },
    );
    logger.info(
      {
        backupId,
        applied: report.applied,
        skipped: report.skipped_already_applied,
        archives: report.archives.map((archive) => ({
          city: archive.city,
          backup_prefix: archive.backup_prefix,
          object_count: archive.object_count,
          digest: archive.digest,
        })),
      },
      "graphify-34-enrich: apply complete",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
