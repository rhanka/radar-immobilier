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
 * PG FEED: when EXPLOITATION runs (either `LIVE_SCRAPE_EXPLOIT=1` or
 * `--reexploit`), the worker builds a Drizzle DB handle and threads it into the
 * exploitation graph-feed so the per-city graph is upserted into Postgres
 * (`upsertGraph`, provenance-preserving union). The handle is FAIL-LOUD: a
 * connectivity ping runs first and the process exits(1) if Postgres is
 * unreachable — a requested exploit/reexploit run must never silently skip PG.
 *
 * `--reexploit` runs EXPLOITATION from ALREADY-STORED raw/parsed (no network
 * scrape): for each requested city it reconstructs the stored records from the
 * object store and replays PARSE + EXPLOITATION + the PG feed. It composes with a
 * slug list / `--chunk`. Because reexploit is pointless without PG, it always
 * builds the DB handle (same fail-loud contract as an exploit run).
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
 */
import { isPdftotextAvailable } from "@radar/sources";

import { loadConfig } from "../config.js";
import { createDb, type DbHandle } from "../db/client.js";
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
  // The PG feed is wired whenever EXPLOITATION runs (exploit OR reexploit): the
  // graph-feed only fires when `runExploitation` receives a `db` handle.
  const wantDb = exploit || reexploit;

  logger.info(
    { cities: label, limit, exploit, reexploit },
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

  // PG FEED (Part 1): when EXPLOITATION runs, build the DB handle and thread it
  // into the exploitation graph-feed so the per-city graph is upserted into
  // Postgres. FAIL-LOUD: ping Postgres first; if it is unreachable, exit(1)
  // rather than silently skipping the DB (the whole point of this run).
  let handle: DbHandle | undefined;
  try {
    if (wantDb) {
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

    return errors.length > 0 ? 1 : 0;
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
