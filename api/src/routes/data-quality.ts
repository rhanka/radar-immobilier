import { Hono } from "hono";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { readAll } from "../services/scrape-status/store.js";
import { mergeWithDerived } from "../services/scrape-status/derive.js";
import { buildDataQualityCitySummary } from "../services/data-quality/summary.js";

export interface DataQualityDeps {
  store: ObjectStore;
  db?: Database;
  now?: () => number;
}

export function dataQualityRoute(deps: DataQualityDeps): Hono {
  const app = new Hono();

  app.get("/api/data-quality/:city", async (c) => {
    const citySlug = c.req.param("city");
    const stored = await readAll(deps.store);
    const scrapeStatuses = mergeWithDerived(stored);
    const summary = await buildDataQualityCitySummary({
      citySlug,
      scrapeStatuses,
      ...(deps.db ? { db: deps.db } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });

    return c.json({ ok: true, summary });
  });

  return app;
}
