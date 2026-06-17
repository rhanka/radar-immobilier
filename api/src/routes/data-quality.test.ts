import { describe, expect, it } from "vitest";
import type { DataQualityCitySummaryT, ScrapeStatusT } from "@radar/domain";
import { dataQualityRoute } from "./data-quality.js";
import { createApp } from "../app.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { upsert } from "../services/scrape-status/store.js";

function makeMemStore(): ObjectStore {
  const data = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      const buf =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : Buffer.isBuffer(body)
            ? new Uint8Array(body)
            : body;
      data.set(key, buf);
      return { key };
    },
    async get(key) {
      const val = data.get(key);
      if (!val) throw new Error(`not found: ${key}`);
      return val;
    },
    async head(key) {
      return data.has(key) ? { key } : null;
    },
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
  };
}

function makeDb(returnQueue: Record<string, unknown>[][]): Database {
  let callIdx = 0;
  const makeChain = (): object => ({
    from: () => makeChain(),
    where: () => {
      const result = returnQueue[callIdx] ?? [];
      callIdx += 1;
      return Promise.resolve(result);
    },
  });

  return {
    select: () => makeChain(),
  } as unknown as Database;
}

function scrapeStatus(
  patch: Partial<ScrapeStatusT> & Pick<ScrapeStatusT, "citySlug" | "source" | "status">,
): ScrapeStatusT {
  return {
    automation: "refresh",
    windowMonths: 6,
    ...patch,
  } as ScrapeStatusT;
}

describe("GET /api/data-quality/:city", () => {
  it("returns a non-persisted city summary from scrape status, graph, zones and lots", async () => {
    const citySlug = "salaberry-de-valleyfield";
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug,
        source: "conseils-municipaux",
        status: "graphified",
        lastRunAt: "2026-06-16T10:00:00.000Z",
      }),
    );
    await upsert(
      store,
      scrapeStatus({
        citySlug,
        source: "youtube-seances",
        status: "identified",
      }),
    );

    const db = makeDb([
      [
        { id: "signal-1", type: "Signal", createdAt: new Date("2026-06-10T00:00:00Z") },
        { id: "bylaw-1", type: "Bylaw", createdAt: new Date("2026-06-10T00:00:00Z") },
        { id: "zone-1", type: "Zone", createdAt: new Date("2026-06-10T00:00:00Z") },
      ],
      [{ srcId: "signal-1", dstId: "bylaw-1" }],
      [{ geom: "POLYGON EMPTY", knownFrom: new Date("2026-06-11T00:00:00Z") }],
      [{ geom: null, knownFrom: new Date("2026-06-12T00:00:00Z") }],
    ]);
    const app = dataQualityRoute({
      store,
      db,
      now: () => Date.parse("2026-06-17T00:00:00Z"),
    });

    const res = await app.request(`/api/data-quality/${citySlug}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      summary: DataQualityCitySummaryT;
    };

    expect(body.ok).toBe(true);
    expect(body.summary.citySlug).toBe(citySlug);
    expect(body.summary.councilMinutes.status).toBe("fresh");
    expect(body.summary.councilMinutes.freshness).toBe("fresh");
    expect(body.summary.councilMinutes.counts.graphified).toBe(1);
    expect(body.summary.youtube.status).toBe("partial");
    expect(body.summary.youtube.freshness).toBe("unknown");
    expect(body.summary.ontology.status).toBe("fresh");
    expect(body.summary.ontology.counts).toMatchObject({
      nodes: 3,
      edges: 1,
      signals: 1,
      zones: 1,
      bylaws: 1,
    });
    expect(body.summary.zones.status).toBe("fresh");
    expect(body.summary.zones.counts.withGeometry).toBe(1);
    expect(body.summary.lots.status).toBe("partial");
    expect(body.summary.lots.source?.availability).toBe("donnees-quebec");
  });

  it("marks collection data stale when lastRunAt is older than the threshold", async () => {
    const citySlug = "stale-city";
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug,
        source: "conseils-municipaux",
        status: "graphified",
        lastRunAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    const app = dataQualityRoute({
      store,
      db: makeDb([[], [], []]),
      now: () => Date.parse("2026-06-17T00:00:00Z"),
    });

    const res = await app.request(`/api/data-quality/${citySlug}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: DataQualityCitySummaryT };

    expect(body.summary.councilMinutes.status).toBe("stale");
    expect(body.summary.councilMinutes.freshness).toBe("stale");
    expect(body.summary.ontology.status).toBe("unknown");
  });

  it("is wired into createApp", async () => {
    const citySlug = "app-wired-city";
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug,
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const app = createApp({
      checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }),
      store,
      db: makeDb([[], [], []]),
    });

    const res = await app.request(`/api/data-quality/${citySlug}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: DataQualityCitySummaryT };
    expect(body.summary.citySlug).toBe(citySlug);
    expect(body.summary.councilMinutes.status).toBe("partial");
  });
});
