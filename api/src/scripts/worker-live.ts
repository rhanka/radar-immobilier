/**
 * worker-live — CLI entry point for the live PV scraper (WORKER LIVE, P1).
 *
 * Scrapes the config-only PV cities live and writes their raw documents to the
 * dedicated scraping object store (Scaleway in prod via SCRAPE_S3_*, MinIO
 * locally). Real execution is left to the conductor; this is a thin wrapper
 * around `runLiveScrape` so it can be invoked from a Makefile target.
 *
 * Usage:
 *   tsx src/scripts/worker-live.ts                 # all config-only cities
 *   tsx src/scripts/worker-live.ts carignan delson # a subset
 *   LIVE_SCRAPE_LIMIT=2 tsx src/scripts/worker-live.ts carignan
 *
 * Env:
 *   LIVE_SCRAPE_LIMIT  optional per-city cap on the number of docs collected.
 */
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { runLiveScrape } from "../services/sources/live-scrape.js";
import { getScrapeObjectStore } from "../storage/s3-object-store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const store = getScrapeObjectStore(config);

  const slugs = process.argv.slice(2);
  const limitEnv = process.env.LIVE_SCRAPE_LIMIT;
  const limit = limitEnv ? Number.parseInt(limitEnv, 10) : undefined;

  logger.info(
    { cities: slugs.length > 0 ? slugs : "all-config-only", limit },
    "worker-live: starting live PV scrape",
  );

  const recap = await runLiveScrape(slugs.length > 0 ? slugs : undefined, {
    store,
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
  });

  for (const r of recap) {
    logger.info(
      { city: r.city, status: r.status, docs: r.count, error: r.error },
      `worker-live: ${r.city} → ${r.status}`,
    );
  }

  const errors = recap.filter((r) => r.status === "error");
  const newCount = recap.filter((r) => r.status === "new").length;
  const seenCount = recap.filter((r) => r.status === "seen").length;
  logger.info(
    { cities: recap.length, new: newCount, seen: seenCount, errors: errors.length },
    "worker-live: done",
  );

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("worker-live: fatal", err);
  process.exit(1);
});
