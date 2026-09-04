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
 *   tsx src/scripts/worker-live.ts --chunk 2/5     # shard 2 of 5 (batch launch)
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
import { citiesChunk, configOnlyCitySlugs, runLiveScrape } from "../services/sources/live-scrape.js";
import { getScrapeObjectStore } from "../storage/s3-object-store.js";

/**
 * Resolve which cities to scrape from argv:
 *   worker-live                     → all config-only cities (undefined)
 *   worker-live carignan delson     → an explicit subset
 *   worker-live --chunk 2/5         → shard 2 of 5 equal, deterministic slices of
 *                                     the full config-only list (batch launching:
 *                                     N parallel jobs run --chunk 1/N … N/N).
 * `--chunk` and an explicit slug list are mutually exclusive. On a malformed
 * `--chunk` we exit(2) rather than silently scraping the wrong set.
 */
function resolveTargets(): { slugs: string[] | undefined; label: string } {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let chunkSpec: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--chunk") chunkSpec = args[++i];
    else if (a.startsWith("--chunk=")) chunkSpec = a.slice("--chunk=".length);
    else positional.push(a);
  }

  if (chunkSpec === undefined) {
    return positional.length > 0
      ? { slugs: positional, label: `${positional.length} city(ies)` }
      : { slugs: undefined, label: "all-config-only" };
  }

  if (positional.length > 0) {
    console.error("worker-live: --chunk and an explicit city list are mutually exclusive");
    process.exit(2);
  }
  const m = /^(\d+)\/(\d+)$/.exec(chunkSpec);
  if (!m) {
    console.error(`worker-live: invalid --chunk '${chunkSpec}' — expected k/n (e.g. 2/5)`);
    process.exit(2);
  }
  const k = Number(m[1]);
  const n = Number(m[2]);
  if (n < 1 || k < 1 || k > n) {
    console.error(`worker-live: invalid --chunk ${k}/${n} — need 1 <= k <= n and n >= 1`);
    process.exit(2);
  }
  const all = configOnlyCitySlugs();
  const slugs = citiesChunk(all, k, n);
  return { slugs, label: `chunk ${k}/${n} (${slugs.length}/${all.length} cities)` };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const store = getScrapeObjectStore(config);

  const { slugs, label } = resolveTargets();
  const limitEnv = process.env.LIVE_SCRAPE_LIMIT;
  const limit = limitEnv ? Number.parseInt(limitEnv, 10) : undefined;
  const exploitEnv = (process.env.LIVE_SCRAPE_EXPLOIT ?? "").toLowerCase();
  const exploit = exploitEnv === "1" || exploitEnv === "true";

  logger.info(
    { cities: label, limit, exploit },
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

  const recap = await runLiveScrape(slugs, {
    store,
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    ...(exploit ? { exploit: true } : {}),
    // Stream per-city progress AS each city finishes — no more "0 lines until the
    // final recap" on a long all-cities run. (Observability only; it does not
    // bound the per-city memory working set — see the memory follow-up.)
    onCity: (r) =>
      logger.info(
        {
          city: r.city,
          status: r.status,
          docs: r.count,
          signals: r.signals,
          error: r.error ?? r.exploitError,
        },
        `worker-live: ${r.city} → ${r.status}`,
      ),
  });

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
