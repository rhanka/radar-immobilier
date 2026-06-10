import { Hono } from "hono";
import { ScrapeStatus, ScrapeStatusSource, cityMaturity } from "@radar/domain";
import type { ObjectStore } from "../storage/object-store.js";
import { readAll, upsert } from "../services/scrape-status/store.js";
import { mergeWithDerived, deriveProvincialCoverage } from "../services/scrape-status/derive.js";

/**
 * Builds the /api/scrape-status routes.
 *
 *   GET  /api/scrape-status                  — list all records (optionally ?city=<slug>)
 *                                              merged with statically-derived real statuses
 *   GET  /api/scrape-status/maturity          — city-level maturity aggregate (0–100)
 *   GET  /api/scrape-status/coverage          — provincial coverage aggregate (1106 cities)
 *   PUT  /api/scrape-status/:city/:source     — upsert a record (agents call this)
 */
export function scrapeStatusRoute(store: ObjectStore): Hono {
  const app = new Hono();

  app.get("/api/scrape-status", async (c) => {
    const cityFilter = c.req.query("city");
    const stored = await readAll(store);
    // Merge stored (manual agent upserts) with statically-derived real statuses.
    // Stored records take priority for the same city×source key.
    const items = mergeWithDerived(stored);
    const filtered = cityFilter ? items.filter((r) => r.citySlug === cityFilter) : items;
    return c.json({ items: filtered });
  });

  /**
   * GET /api/scrape-status/maturity
   *
   * Returns the aggregated maturity score (0–100) per city across all sources,
   * derived from the merged (static + stored) ScrapeStatus records.
   *
   * Response:
   *   { items: [{ citySlug: string, maturity: number, sourceCount: number }] }
   */
  app.get("/api/scrape-status/maturity", async (c) => {
    const stored = await readAll(store);
    const all = mergeWithDerived(stored);

    // Group by city
    const byCity = new Map<string, typeof all>();
    for (const rec of all) {
      const existing = byCity.get(rec.citySlug) ?? [];
      byCity.set(rec.citySlug, [...existing, rec]);
    }

    const items = Array.from(byCity.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([citySlug, cityItems]) => ({
        citySlug,
        maturity: cityMaturity(cityItems),
        sourceCount: cityItems.length,
      }));

    return c.json({ items });
  });

  /**
   * GET /api/scrape-status/coverage
   *
   * Returns the provincial coverage aggregate for "conseils-municipaux" across
   * all 1106 QC municipalities. Counts are derived from the merged
   * (static + stored) ScrapeStatus records — never invented.
   *
   * Response:
   *   {
   *     total: number,           // always 1106 (QC_MUNICIPALITIES.length)
   *     byStatus: { todo, identified, scraped, graphified, error },
   *     byMrc: { [mrcName]: { total, scraped, todo } }
   *   }
   */
  app.get("/api/scrape-status/coverage", async (c) => {
    const stored = await readAll(store);
    const all = mergeWithDerived(stored);
    const coverage = deriveProvincialCoverage(all);
    return c.json(coverage);
  });

  app.put("/api/scrape-status/:city/:source", async (c) => {
    const source = c.req.param("source");
    // Validate source is one of the known enum values
    const sourceCheck = ScrapeStatusSource.safeParse(source);
    if (!sourceCheck.success) {
      return c.json(
        {
          ok: false,
          error: "unknown-source",
          detail: `Unknown source "${source}". Valid: ${ScrapeStatusSource.options.join(", ")}`,
        },
        400,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid-json" }, 400);
    }

    const parsed = ScrapeStatus.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "validation-failed", detail: parsed.error.format() },
        400,
      );
    }

    const updated = await upsert(store, parsed.data);
    return c.json({ item: parsed.data, items: updated });
  });

  return app;
}
