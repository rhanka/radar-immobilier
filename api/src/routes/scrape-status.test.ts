import { describe, expect, it } from "vitest";
import type { ScrapeStatusT } from "@radar/domain";
import { scrapeStatusRoute } from "./scrape-status.js";
import type { ObjectStore } from "../storage/object-store.js";
import { ALL_PV_CITIES } from "@radar/sources";

/** In-memory ObjectStore stub for tests — no MinIO required. */
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
      return [...data.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

describe("GET /api/scrape-status (empty store)", () => {
  it("returns derived real statuses even with an empty store", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ScrapeStatusT[] };
    // With derivation from ALL_PV_CITIES + MAMH cities, items is never empty.
    // Each PV city contributes one "conseils-municipaux" record (scraped),
    // plus salaberry-de-valleyfield and beauharnois each contribute 3+ records.
    expect(body.items.length).toBeGreaterThan(ALL_PV_CITIES.length);
    // All PV cities have at least a "conseils-municipaux" record with status "scraped"
    const pvCitySlugs = ALL_PV_CITIES.map((c) => c.config.citySlug);
    for (const slug of pvCitySlugs) {
      const cityItems = body.items.filter(
        (r) => r.citySlug === slug && r.source === "conseils-municipaux",
      );
      expect(cityItems).toHaveLength(1);
      expect(cityItems[0]!.status).toBe("scraped");
      expect(cityItems[0]!.dataQuality).toBe("pdf");
    }
    // MAMH cities have avis-publics graphified
    const valleyfield = body.items.filter(
      (r) => r.citySlug === "salaberry-de-valleyfield" && r.source === "avis-publics",
    );
    expect(valleyfield).toHaveLength(1);
    expect(valleyfield[0]!.status).toBe("graphified");
  });
});

describe("GET /api/scrape-status?city=valleyfield", () => {
  it("returns only items for the specified city", async () => {
    const store = makeMemStore();
    const app = scrapeStatusRoute(store);

    // Seed two cities
    await app.request("/api/scrape-status/valleyfield/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "zonage",
        automation: "one_shot",
        status: "scraped",
      }),
    });
    await app.request("/api/scrape-status/beauharnois/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "beauharnois",
        source: "zonage",
        automation: "one_shot",
        status: "todo",
      }),
    });

    const res = await app.request("/api/scrape-status?city=valleyfield");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ScrapeStatusT[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.citySlug).toBe("valleyfield");
  });
});

describe("PUT /api/scrape-status/:city/:source", () => {
  it("creates a new record and returns it", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/valleyfield/avis-publics", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "avis-publics",
        automation: "refresh",
        status: "identified",
        siteUrl: "https://valleyfield.ca/avis",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      item: ScrapeStatusT;
      items: ScrapeStatusT[];
    };
    expect(body.item.citySlug).toBe("valleyfield");
    expect(body.item.source).toBe("avis-publics");
    expect(body.item.status).toBe("identified");
    expect(body.items).toHaveLength(1);
  });

  it("upserts an existing record", async () => {
    const store = makeMemStore();
    const app = scrapeStatusRoute(store);

    await app.request("/api/scrape-status/valleyfield/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "zonage",
        automation: "one_shot",
        status: "todo",
      }),
    });
    const res2 = await app.request("/api/scrape-status/valleyfield/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "zonage",
        automation: "one_shot",
        status: "scraped",
      }),
    });
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as { items: ScrapeStatusT[] };
    // Only 1 record after upsert (no duplicate)
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.status).toBe("scraped");
  });

  it("returns 400 for an unknown source in URL params", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request(
      "/api/scrape-status/valleyfield/unknown-source",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          citySlug: "valleyfield",
          source: "unknown-source",
          automation: "one_shot",
          status: "todo",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid body (bad status)", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/valleyfield/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "zonage",
        automation: "one_shot",
        status: "not-a-real-status",
      }),
    });
    expect(res.status).toBe(400);
  });
});
