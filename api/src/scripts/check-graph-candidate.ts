/**
 * check-graph-candidate — read-only COHORT pre-flight for the §7 grounding.
 *
 * For each city, it fetches the grounded candidate `graph/<city>/latest.json`
 * from the graph object store (same GRAPH_S3_* / SCRAPE_S3_* / S3_* resolution
 * as `project-graph-from-s3`), reads the CURRENT Postgres node snapshot for that
 * city, and predicts — WITHOUT writing anything — whether `upsertGraphAtomic`
 * would ABORT the projection (business-property regression OR completeness
 * regression). It reuses the exact exported guard functions, so its verdict
 * cannot drift from the real projection.
 *
 * Use it BEFORE running the cohort: a candidate that is not grounded on its
 * complete baseline (e.g. citation-only, dropping reglement_number) is caught
 * here instead of aborting mid-run and wasting a projection.
 *
 * READ-ONLY: SELECT from PG + GET from S3 only. No INSERT/UPDATE/DELETE, no
 * transaction. Safe to run against preprod (or prod, read-only) any time.
 *
 * Exit code: 1 if AT LEAST one city would abort OR a candidate is invalid/
 * unreadable (fail-fast for cohort CI); 0 if every checked candidate is clean.
 *
 * Usage:
 *   tsx src/scripts/check-graph-candidate.ts                 # every graph/<slug>/latest.json
 *   tsx src/scripts/check-graph-candidate.ts sainte-martine  # explicit slugs
 *
 * Env (via process.env, same as project-graph-from-s3):
 *   GRAPH_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY/REGION/FORCE_PATH_STYLE
 *   (each falling back to SCRAPE_S3_* then S3_*), plus the DB connection.
 */
import { eq } from "drizzle-orm";
import { loadConfig, resolveGraphS3Config } from "../config.js";
import { createLogger } from "../logger.js";
import { createDb } from "../db/client.js";
import { graphNodes } from "../db/schema.js";
import {
  createScrapeS3Client,
  S3ObjectStore,
} from "../storage/s3-object-store.js";
import { predictProjectionAbort } from "../services/graph/graph-candidate-check.js";

const decoder = new TextDecoder();

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const graphS3Config = resolveGraphS3Config(config);

  logger.info(
    { endpoint: graphS3Config.endpoint, bucket: graphS3Config.bucket, region: graphS3Config.region },
    "check-graph-candidate: connecting to graph object store (READ-ONLY)",
  );

  const s3Client = createScrapeS3Client(graphS3Config);
  const store = new S3ObjectStore(s3Client, graphS3Config.bucket);
  const { db, pool } = createDb(config);

  const argSlugs = process.argv.slice(2);
  let keys: string[];
  if (argSlugs.length > 0) {
    keys = argSlugs.map((slug) => `graph/${slug}/latest.json`);
    logger.info({ slugs: argSlugs }, "check-graph-candidate: selective mode");
  } else {
    logger.info("check-graph-candidate: full mode — listing graph/*");
    keys = ((await store.list?.("graph/")) ?? []).filter((k) => k.endsWith("/latest.json"));
    logger.info({ total: keys.length }, "check-graph-candidate: keys found");
  }

  let clean = 0;
  let wouldAbort = 0;
  let skipped = 0;
  let errors = 0;
  const abortCities: string[] = [];

  for (const key of keys) {
    const parts = key.split("/");
    const citySlug = parts[1] ?? key;

    let raw: Uint8Array;
    try {
      raw = await store.get(key);
    } catch (err) {
      logger.warn({ key, err: String(err) }, "check-graph-candidate: GET failed, skipped");
      skipped++;
      continue;
    }

    let graphJson: unknown;
    try {
      graphJson = JSON.parse(decoder.decode(raw));
    } catch (err) {
      logger.warn({ key, err: String(err) }, "check-graph-candidate: invalid JSON, skipped");
      skipped++;
      continue;
    }

    if (
      typeof graphJson !== "object" ||
      graphJson === null ||
      !Array.isArray((graphJson as Record<string, unknown>).nodes)
    ) {
      logger.debug({ key }, "check-graph-candidate: no `nodes` field, skipped");
      skipped++;
      continue;
    }

    // Current PG snapshot for this city (the projection's "before").
    const beforeRows = await db
      .select({ id: graphNodes.id, type: graphNodes.type, props: graphNodes.props })
      .from(graphNodes)
      .where(eq(graphNodes.citySlug, citySlug));

    try {
      const r = predictProjectionAbort(
        citySlug,
        beforeRows.map((row) => ({
          id: row.id,
          type: row.type,
          props: (row.props ?? {}) as Record<string, unknown>,
        })),
        graphJson,
      );
      if (r.wouldAbort) {
        wouldAbort++;
        abortCities.push(citySlug);
        logger.warn(
          {
            citySlug,
            candidateNodes: r.candidateNodeCount,
            completeBefore: r.completeBefore,
            completeAfter: r.completeAfter,
            reasons: r.reasons,
          },
          "check-graph-candidate: WOULD ABORT — candidate incomplete (fix baseline lineage before the cohort)",
        );
      } else {
        clean++;
        logger.info(
          {
            citySlug,
            candidateNodes: r.candidateNodeCount,
            completeBefore: r.completeBefore,
            completeAfter: r.completeAfter,
          },
          "check-graph-candidate: clean — projection would proceed",
        );
      }
    } catch (err) {
      // Schema parse failure = structurally invalid candidate → would fail the
      // real projection with an ERROR (not an abort). Fail-fast either way.
      logger.error({ citySlug, key, err: String(err) }, "check-graph-candidate: candidate INVALID");
      errors++;
    }
  }

  logger.info(
    {
      clean,
      wouldAbort,
      skipped,
      errors,
      total: keys.length,
      ...(abortCities.length > 0 ? { abortCities } : {}),
    },
    "check-graph-candidate: done (READ-ONLY, nothing written)",
  );

  await pool.end();
  process.exit(wouldAbort > 0 || errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("check-graph-candidate: fatal", err);
  process.exit(1);
});
