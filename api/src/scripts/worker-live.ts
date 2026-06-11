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
 *   LIVE_SCRAPE_LIMIT    optional per-city cap on the number of docs collected.
 *   LIVE_SCRAPE_EXPLOIT  when "1"/"true", also run EXPLOITATION after each
 *                        city's RECUEIL: PARSE the raw PV (pdftotext via poppler)
 *                        + project the real DesignationEvents into the per-city
 *                        project-state (`ontology/{city}/project-state.json`),
 *                        i.e. the key the Signaux view reads. Off by default.
 */
import { isPdftotextAvailable } from "@radar/sources";

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
  const exploitEnv = (process.env.LIVE_SCRAPE_EXPLOIT ?? "").toLowerCase();
  const exploit = exploitEnv === "1" || exploitEnv === "true";

  logger.info(
    { cities: slugs.length > 0 ? slugs : "all-config-only", limit, exploit },
    "worker-live: starting live PV scrape",
  );

  // Preflight: EXPLOITATION extracts every PV PDF's text via `pdftotext`
  // (poppler). If the binary is missing the adapter silently yields "" → 0
  // signal on real PDFs. Surface that as a LOUD diagnostic instead of a silent
  // false-negative. We do not abort RECUEIL (raw capture still works); we warn
  // so the empty-signal run is never mistaken for "no opportunities found".
  if (exploit && !(await isPdftotextAvailable())) {
    logger.error(
      { binary: "pdftotext", remedy: "install poppler-utils in this image" },
      "worker-live: pdftotext (poppler) NOT available — every PV PDF will " +
        "extract to EMPTY text and EXPLOITATION will produce 0 signal. This " +
        "is a misconfigured image, not an absence of opportunities.",
    );
  }

  const recap = await runLiveScrape(slugs.length > 0 ? slugs : undefined, {
    store,
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    ...(exploit ? { exploit: true } : {}),
  });

  for (const r of recap) {
    logger.info(
      {
        city: r.city,
        status: r.status,
        docs: r.count,
        signals: r.signals,
        error: r.error ?? r.exploitError,
      },
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
