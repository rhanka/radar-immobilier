import { Hono } from "hono";
import { ScrapeStatus, ScrapeStatusSource } from "@radar/domain";
import type { ObjectStore } from "../storage/object-store.js";
import { readAll, upsert } from "../services/scrape-status/store.js";

/**
 * Builds the /api/scrape-status routes.
 *
 *   GET  /api/scrape-status           — list all records (optionally ?city=<slug>)
 *   PUT  /api/scrape-status/:city/:source — upsert a record (agents call this)
 */
export function scrapeStatusRoute(store: ObjectStore): Hono {
  const app = new Hono();

  app.get("/api/scrape-status", async (c) => {
    const cityFilter = c.req.query("city");
    const all = await readAll(store);
    const items = cityFilter ? all.filter((r) => r.citySlug === cityFilter) : all;
    return c.json({ items });
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
