import { describe, expect, it } from "vitest";
import type { ScrapeStatusT } from "@radar/domain";
import { sourceCoverageRoute } from "./source-coverage.js";
import { createApp } from "../app.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { upsert } from "../services/scrape-status/store.js";

const NOW_ISO = "2026-06-29T00:00:00.000Z";
const NOW = () => Date.parse(NOW_ISO);
const RECENT = new Date("2026-06-20T00:00:00Z");

interface CoverageCell {
  state: "verified" | "declared" | "absent";
  freshness: "fresh" | "partial" | "stale" | "unknown";
}
interface RawCell extends CoverageCell {
  count: number;
}
interface GraphCell extends CoverageCell {
  ontologyVersion: string | null;
}
interface GeoCell extends CoverageCell {
  served: boolean;
}
interface CityCoverage {
  citySlug: string;
  cityName: string;
  mrc: string | null;
  priorityRank: number | null;
  l1Raw: RawCell;
  l2Graph: GraphCell;
  l4Zonage: GeoCell;
  l5Lots: GeoCell;
  worstStatus: "verified" | "declared" | "absent";
  nextMarginalGain: "zonage" | "lots" | null;
}
interface CoverageResponse {
  generatedAt: string;
  totals: {
    cities: number;
    l1Raw: number;
    l2Graph: number;
    l4Zonage: number;
    l5Lots: number;
  };
  cities: CityCoverage[];
}

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

/**
 * DB mock: the route runs exactly three aggregated GROUP BY queries, in order
 * graph → zones → lots. Each resolves the next array in the queue. The chain
 * select().from().where().groupBy() mirrors the route's bulk reads.
 */
function makeDb(queue: Record<string, unknown>[][]): Database {
  let idx = 0;
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.groupBy = () => {
    const result = queue[idx] ?? [];
    idx += 1;
    return Promise.resolve(result);
  };
  return { select: () => chain } as unknown as Database;
}

function scrapeStatus(
  patch: Partial<ScrapeStatusT> &
    Pick<ScrapeStatusT, "citySlug" | "source" | "status">,
): ScrapeStatusT {
  return { automation: "refresh", windowMonths: 6, ...patch } as ScrapeStatusT;
}

function cityOf(body: CoverageResponse, slug: string): CityCoverage {
  const city = body.cities.find((c) => c.citySlug === slug);
  if (!city) throw new Error(`city not found in response: ${slug}`);
  return city;
}

async function request(deps: {
  store: ObjectStore;
  db?: Database;
}): Promise<CoverageResponse> {
  const app = sourceCoverageRoute({ ...deps, now: NOW });
  const res = await app.request("/api/source/coverage");
  expect(res.status).toBe(200);
  return (await res.json()) as CoverageResponse;
}

describe("GET /api/source/coverage", () => {
  it("returns the province-wide contract shape with coherent totals", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const body = await request({ store, db: makeDb([[], [], []]) });

    expect(typeof body.generatedAt).toBe("string");
    expect(body.generatedAt).toBe(NOW_ISO);

    // Province-wide: every QC municipality is present, totals.cities matches.
    expect(body.cities.length).toBeGreaterThan(1000);
    expect(body.totals.cities).toBe(body.cities.length);

    // Each cell carries the contracted tri-state + freshness shape.
    const sample = cityOf(body, "brossard");
    expect(sample.cityName).toBe("Brossard");
    expect(sample.l1Raw).toMatchObject({
      state: expect.any(String),
      count: expect.any(Number),
      freshness: expect.any(String),
    });
    expect(sample.l2Graph).toHaveProperty("ontologyVersion");
    expect(sample.l4Zonage).toHaveProperty("served");
    expect(sample.l5Lots).toHaveProperty("served");
    expect(sample).toHaveProperty("worstStatus");
    expect(sample).toHaveProperty("nextMarginalGain");

    // Totals are the count of cities reaching `verified` at each layer.
    const verifiedAt = (sel: (c: CityCoverage) => CoverageCell) =>
      body.cities.filter((c) => sel(c).state === "verified").length;
    expect(body.totals.l1Raw).toBe(verifiedAt((c) => c.l1Raw));
    expect(body.totals.l2Graph).toBe(verifiedAt((c) => c.l2Graph));
    expect(body.totals.l4Zonage).toBe(verifiedAt((c) => c.l4Zonage));
    expect(body.totals.l5Lots).toBe(verifiedAt((c) => c.l5Lots));
  });

  it("honours the tri-state: verified (live), declared (claimed, unsubstantiated), absent", async () => {
    const store = makeMemStore();
    // brossard: raw scraped → L1 verified, no graph/geo → downstream absent.
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    // salaberry & beauharnois derive `graphified` raw sources (seeded MAMH).
    // Provide live graph rows ONLY for salaberry.
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 10,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
    ]);
    const body = await request({ store, db });

    // verified L1: a real scrape capture.
    const brossard = cityOf(body, "brossard");
    expect(brossard.l1Raw.state).toBe("verified");

    // verified L2: live graph rows substantiate the graph.
    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l2Graph.state).toBe("verified");
    expect(valleyfield.l2Graph.ontologyVersion).toBe("v2.3");

    // declared L2: scrape-status claims `graphified` but NO live graph rows.
    const beauharnois = cityOf(body, "beauharnois");
    expect(beauharnois.l1Raw.state).toBe("verified"); // raw graphified
    expect(beauharnois.l2Graph.state).toBe("declared");
    expect(beauharnois.l2Graph.ontologyVersion).toBeNull();

    // absent: a plain todo city with nothing anywhere.
    const empty = body.cities.find(
      (c) =>
        c.l1Raw.state === "absent" &&
        c.l2Graph.state === "absent" &&
        c.l4Zonage.state === "absent" &&
        c.l5Lots.state === "absent",
    );
    expect(empty).toBeDefined();
    expect(empty?.worstStatus).toBe("absent");
  });

  it("sets worstStatus to the most-behind step (L1 verified but downstream absent → absent)", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const body = await request({ store, db: makeDb([[], [], []]) });

    const brossard = cityOf(body, "brossard");
    expect(brossard.l1Raw.state).toBe("verified");
    expect(brossard.l2Graph.state).toBe("absent");
    expect(brossard.l4Zonage.state).toBe("absent");
    expect(brossard.l5Lots.state).toBe("absent");
    // Anti-survente: a single verified step never paints the city green.
    expect(brossard.worstStatus).toBe("absent");
  });

  it("flags nextMarginalGain=zonage for a graphified city without served zonage", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 8,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [], // no zone versions → zonage not served
      [], // no lot versions
    ]);
    const body = await request({ store, db });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l2Graph.state).toBe("verified");
    expect(valleyfield.l4Zonage.served).toBe(false);
    expect(valleyfield.nextMarginalGain).toBe("zonage");
  });

  it("advances nextMarginalGain to lots once zonage is served but lots are not", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 8,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [
        {
          citySlug: "salaberry-de-valleyfield",
          currentVersions: 5,
          withGeometry: 5, // served
          lastKnownFrom: RECENT,
        },
      ],
      [], // lots not served
    ]);
    const body = await request({ store, db });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l2Graph.state).toBe("verified");
    expect(valleyfield.l4Zonage.served).toBe(true);
    expect(valleyfield.l4Zonage.state).toBe("verified");
    expect(valleyfield.l5Lots.served).toBe(false);
    expect(valleyfield.nextMarginalGain).toBe("lots");
  });

  it("does not propose a marginal gain for a city that is not graphified live", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const body = await request({ store, db: makeDb([[], [], []]) });

    const brossard = cityOf(body, "brossard");
    expect(brossard.l2Graph.state).not.toBe("verified");
    expect(brossard.nextMarginalGain).toBeNull();
  });

  it("is wired into createApp", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const app = createApp({
      checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }),
      store,
      db: makeDb([[], [], []]),
      now: NOW,
    });

    const res = await app.request("/api/source/coverage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoverageResponse;
    expect(body.totals.cities).toBe(body.cities.length);
    expect(cityOf(body, "brossard").l1Raw.state).toBe("verified");
  });
});
