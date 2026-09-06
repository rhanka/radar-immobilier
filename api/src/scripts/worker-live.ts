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
 *   tsx src/scripts/worker-live.ts --reexploit     # replay exploitation, NO scrape
 *   LIVE_SCRAPE_LIMIT=2 tsx src/scripts/worker-live.ts carignan
 *
 * PG FEED (opt-in on explicit credentials): the worker feeds Postgres directly
 * from EXPLOITATION only when it is actually wired for it (see `decidePgFeed`):
 *   - `--reexploit` ALWAYS feeds PG — its sole purpose is to (re)project stored
 *     raw into Postgres — and is FAIL-LOUD: a connectivity ping runs first and
 *     the process exits(1) if Postgres is unreachable.
 *   - plain `LIVE_SCRAPE_EXPLOIT=1` feeds PG only when Postgres CREDENTIALS are
 *     explicitly present in the environment (`POSTGRES_PASSWORD`, injected by a
 *     job that wires the `radar-db-credentials` secret). When wired, the feed is
 *     FAIL-LOUD too. When NOT wired — the boot/OOM diag and the 33/33b/34 scrape
 *     jobs, which leave PG projection to the dedicated S3→PG step — the run does
 *     NOT build a handle: it scrapes/exploits to S3 only and logs "PG feed: OFF"
 *     with a warning. It must not be forced to reach a DB it was never given
 *     credentials for (that is what broke the pinned-image diag pre-fix).
 * When a handle IS built, the per-city graph is upserted via `upsertGraph`
 * (provenance-preserving union).
 *
 * Exit code (JOB HEALTH, not per-city data-quality — see `assessJobHealth`):
 *   0  the run's MACHINERY ran. Per-city source errors (a city unreachable / HTTP
 *      4xx / fetch-failed) are a normal, expected data-quality event and are
 *      TOLERATED; the idempotent PG feed still succeeded.
 *   1  Postgres was unreachable on a PG-feed job (the `select 1` ping path), OR a
 *      SYSTEMIC failure — either the RECUEIL axis (per-city fetch-error RATE
 *      reached `LIVE_SCRAPE_MAX_ERROR_RATE`, default 0.9), or the EXPLOITATION
 *      axis (pdftotext/poppler missing so every PV extracts to empty, or a PG
 *      feed was expected yet 0 cities were upserted despite cities being fetched
 *      — a broken exploitation / PG-write path).
 * Two-tier WARN (both exit 0): a fetch-error rate ≥ `LIVE_SCRAPE_WARN_ERROR_RATE`
 * (default 0.5) is logged as an ELEVATED, alertable degradation; a smaller handful
 * of per-city errors is logged as NORMAL tolerated data-quality.
 *
 * Env:
 *   LIVE_SCRAPE_LIMIT    optional per-city cap on the number of docs collected.
 *   LIVE_SCRAPE_EXPLOIT  when "1"/"true", also run EXPLOITATION after each
 *                        city's RECUEIL: PARSE the raw PV (pdftotext via poppler)
 *                        + project the real DesignationEvents into the per-city
 *                        project-state (`ontology/{city}/project-state.json`),
 *                        i.e. the key the Signaux view reads. Off by default.
 *                        Ignored when `--reexploit` is passed (reexploit already
 *                        implies exploitation).
 *   LIVE_SCRAPE_MAX_ERROR_RATE
 *                        float in (0,1]; the per-city fetch-error RATE at/above
 *                        which the RECUEIL axis is a systemic failure and the run
 *                        exits 1. Default 0.9. NaN / out-of-range falls back to 0.9.
 *   LIVE_SCRAPE_WARN_ERROR_RATE
 *                        float in (0,1]; the fetch-error RATE at/above which the run
 *                        logs an ELEVATED (alertable) degradation warning while still
 *                        exiting 0. Default 0.5. NaN / out-of-range falls back to 0.5.
 */
import { isPdftotextAvailable } from "@radar/sources";

import { loadConfig } from "../config.js";
import { createDb, type DbHandle } from "../db/client.js";
import { createLogger } from "../logger.js";
import { citiesChunk, configOnlyCitySlugs, runLiveScrape } from "../services/sources/live-scrape.js";
import { getScrapeObjectStore } from "../storage/s3-object-store.js";
import { assessJobHealth } from "./job-health.js";
import { decidePgFeed } from "./pg-feed-decision.js";

/**
 * Resolve which cities to scrape from argv:
 *   worker-live                     → all config-only cities (undefined)
 *   worker-live carignan delson     → an explicit subset
 *   worker-live --chunk 2/5         → shard 2 of 5 equal, deterministic slices of
 *                                     the full config-only list (batch launching:
 *                                     N parallel jobs run --chunk 1/N … N/N).
 * `--chunk` and an explicit slug list are mutually exclusive. On a malformed
 * `--chunk` we exit(2) rather than silently scraping the wrong set. `--reexploit`
 * is an independent flag that composes with either selection (slug list or
 * `--chunk`); it flips the run into no-scrape replay mode.
 */
function resolveTargets(): {
  slugs: string[] | undefined;
  label: string;
  reexploit: boolean;
} {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let chunkSpec: string | undefined;
  let reexploit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--chunk") chunkSpec = args[++i];
    else if (a.startsWith("--chunk=")) chunkSpec = a.slice("--chunk=".length);
    else if (a === "--reexploit") reexploit = true;
    else positional.push(a);
  }

  if (chunkSpec === undefined) {
    return positional.length > 0
      ? { slugs: positional, label: `${positional.length} city(ies)`, reexploit }
      : { slugs: undefined, label: "all-config-only", reexploit };
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
  return {
    slugs,
    label: `chunk ${k}/${n} (${slugs.length}/${all.length} cities)`,
    reexploit,
  };
}

async function main(): Promise<number> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const store = getScrapeObjectStore(config);

  const { slugs, label, reexploit } = resolveTargets();
  const limitEnv = process.env.LIVE_SCRAPE_LIMIT;
  const limit = limitEnv ? Number.parseInt(limitEnv, 10) : undefined;
  const exploitEnv = (process.env.LIVE_SCRAPE_EXPLOIT ?? "").toLowerCase();
  // `--reexploit` implies exploitation; a plain exploit run is opt-in via env.
  const exploit = reexploit || exploitEnv === "1" || exploitEnv === "true";
  // Decide whether to feed Postgres directly (and whether an unreachable DB is
  // fatal): always for `--reexploit`, opt-in on explicit credentials for a plain
  // exploit run, never otherwise. See `decidePgFeed`.
  const pgFeed = decidePgFeed({ exploit, reexploit, env: process.env });

  logger.info(
    { cities: label, limit, exploit, reexploit, pgFeed: pgFeed.feed },
    "worker-live: starting live PV scrape",
  );

  // Preflight: EXPLOITATION extracts every PV PDF's text via `pdftotext`
  // (poppler). If the binary is missing the adapter silently yields "" → 0
  // signal on real PDFs. Surface that as a LOUD diagnostic instead of a silent
  // false-negative. We do not abort RECUEIL (raw capture still works); we warn
  // so the empty-signal run is never mistaken for "no opportunities found". The
  // captured boolean also drives the EXPLOITATION axis of the exit verdict below.
  const pdftotextAvailable = exploit ? await isPdftotextAvailable() : true;
  if (exploit && !pdftotextAvailable) {
    logger.error(
      { binary: "pdftotext", remedy: "install poppler-utils in this image" },
      "worker-live: pdftotext (poppler) NOT available — every PV PDF will " +
        "extract to EMPTY text and EXPLOITATION will produce 0 signal. This " +
        "is a misconfigured image, not an absence of opportunities.",
    );
  }

  // PG FEED: build the DB handle + fail-loud ping ONLY when we are actually wired
  // to feed PG (see `decidePgFeed`). FAIL-LOUD: ping Postgres first; if it is
  // unreachable, exit(1) rather than silently skipping a feed the caller asked
  // for. When we are NOT wired (a plain exploit run with no DB credentials — the
  // boot/OOM diag and the 33/33b/34 scrape jobs), do not build a handle: log a
  // loud "PG feed: OFF" warning and run S3-only (the dedicated S3→PG projection
  // step feeds PG for those). This is a visible decision, not a silent skip.
  let handle: DbHandle | undefined;
  try {
    if (pgFeed.feed) {
      handle = createDb(config);
      try {
        await handle.pool.query("select 1");
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "worker-live: Postgres connectivity ping FAILED — refusing to run a " +
            "PG-feed job that would silently skip the DB. Check POSTGRES_* config " +
            "and that Postgres is reachable.",
        );
        return 1; // finally closes the pool, then main's caller exits(1)
      }
    } else {
      logger.warn(
        { reason: pgFeed.reason },
        "worker-live: PG feed OFF — EXPLOITATION will not write to Postgres " +
          "directly (S3-only). Expected for a scrape/exploit job with no DB " +
          "credentials wired; the dedicated S3→PG projection step feeds PG.",
      );
    }

    const recap = await runLiveScrape(slugs, {
      store,
      ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
      ...(exploit ? { exploit: true } : {}),
      ...(reexploit ? { reexploit: true } : {}),
      ...(handle ? { db: handle.db } : {}),
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
    // Cities whose exploitation ran to completion (signals projected, no
    // exploit error) — i.e. those whose graph was fed to PG when a db was used.
    const upserted = recap.filter(
      (r) => r.signals !== undefined && r.exploitError === undefined,
    ).length;

    logger.info(
      { cities: recap.length, new: newCount, seen: seenCount, errors: errors.length },
      "worker-live: done",
    );
    logger.info(
      handle ? { upserted } : {},
      handle ? `PG feed: ON (${upserted} cities upserted)` : "PG feed: OFF",
    );

    // Exit code reflects JOB HEALTH across two axes (RECUEIL fetch rate +
    // EXPLOITATION machinery), not per-city data-quality. Per-city source errors
    // (unreachable / 4xx / fetch-failed) are TOLERATED; the Job is only failed on
    // a SYSTEMIC failure. See `assessJobHealth`. Both thresholds are floats in
    // (0,1]; a NaN / out-of-range env falls back to the safe default.
    const parseRate = (raw: string | undefined, fallback: number): number => {
      const n = Number.parseFloat(raw ?? "");
      return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
    };
    const maxErrorRate = parseRate(process.env.LIVE_SCRAPE_MAX_ERROR_RATE, 0.9);
    const elevatedWarnRate = parseRate(process.env.LIVE_SCRAPE_WARN_ERROR_RATE, 0.5);
    const errorRate = recap.length > 0 ? errors.length / recap.length : 0;
    const health = assessJobHealth({
      errorCount: errors.length,
      cityCount: recap.length,
      maxErrorRate,
      elevatedWarnRate,
      exploitRequested: exploit,
      feedExpected: pgFeed.feed,
      upserted,
      pdftotextAvailable,
    });

    if (health.code === 1) {
      logger.error(
        {
          errorCount: errors.length,
          errorRate,
          maxErrorRate,
          elevatedWarnRate,
          upserted,
          exploit,
          feedExpected: pgFeed.feed,
          pdftotextAvailable,
          cities: errors.map((e) => e.city),
        },
        health.reason,
      );
    } else if (health.warn === "elevated") {
      logger.warn(
        {
          errorCount: errors.length,
          errorRate,
          elevatedWarnRate,
          cities: errors.map((e) => e.city),
        },
        health.reason,
      );
    } else if (health.warn === "normal") {
      logger.warn(
        { errorCount: errors.length, errorRate, cities: errors.map((e) => e.city) },
        health.reason,
      );
    }

    return health.code;
  } finally {
    // Always release the pool (both success and error paths) so the process can
    // exit cleanly instead of hanging on an open connection.
    if (handle) await handle.pool.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("worker-live: fatal", err);
    process.exit(1);
  });
