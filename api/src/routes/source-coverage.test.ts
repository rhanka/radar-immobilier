import { describe, expect, it, vi } from "vitest";
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
interface SignalsCell extends CoverageCell {
  count: number;
  withCitation: number;
}
interface GeoCell extends CoverageCell {
  served: boolean;
  servedBy: "geo" | "local" | null;
}
interface CityCoverage {
  citySlug: string;
  cityName: string;
  mrc: string | null;
  priorityRank: number | null;
  l1Raw: RawCell;
  l2Graph: GraphCell;
  signals: SignalsCell;
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
    signals: number;
    l4Zonage: number;
    l5Lots: number;
  };
  cities: CityCoverage[];
}
interface CityGrillesResponse {
  citySlug: string;
  available: boolean;
  zoneCount?: number;
  zonesWithGrille?: number;
  zonesWithNormes?: number;
  covered?: number;
  state?: "verified" | "declared" | "absent";
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
 * DB mock: the route runs exactly four aggregated GROUP BY queries, in order
 * graph → zones → lots → signals. Each resolves the next array in the queue
 * (missing entries resolve to []). The chain select().from().where().groupBy()
 * mirrors the route's bulk reads.
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

/** Offline par défaut : les tests unitaires ne touchent JAMAIS le réseau. */
const offlineFetch: typeof fetch = () =>
  Promise.reject(new Error("offline (unit test)"));

/** fetch mock renvoyant un listing OGC /collections avec les ids donnés. */
function listingFetch(ids: string[]): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({ collections: ids.map((id) => ({ id })) }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as unknown as typeof fetch;
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
  fetchImpl?: typeof fetch;
}): Promise<CoverageResponse> {
  const app = sourceCoverageRoute({
    fetchImpl: offlineFetch,
    ...deps,
    now: NOW,
  });
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
    expect(sample.signals).toMatchObject({
      state: expect.any(String),
      count: expect.any(Number),
      withCitation: expect.any(Number),
      freshness: expect.any(String),
    });
    expect(sample.l4Zonage).toHaveProperty("served");
    expect(sample.l4Zonage).toHaveProperty("servedBy");
    expect(sample.l5Lots).toHaveProperty("served");
    expect(sample).toHaveProperty("worstStatus");
    expect(sample).toHaveProperty("nextMarginalGain");

    // Totals are the count of cities reaching `verified` at each layer.
    const verifiedAt = (sel: (c: CityCoverage) => CoverageCell) =>
      body.cities.filter((c) => sel(c).state === "verified").length;
    expect(body.totals.l1Raw).toBe(verifiedAt((c) => c.l1Raw));
    expect(body.totals.l2Graph).toBe(verifiedAt((c) => c.l2Graph));
    expect(body.totals.signals).toBe(verifiedAt((c) => c.signals));
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

  // ── BUG 1 : « servi » = listing LIVE geo, pas le seul PG local ─────────────

  it("marks zonage/lots served from the LIVE geo listing (PG empty)", async () => {
    const store = makeMemStore();
    const fetchImpl = listingFetch([
      "qc-zonage-salaberry-de-valleyfield",
      "qc-lots-salaberry-de-valleyfield",
      "qc-lots-saint-hippolyte",
      // Variante suffixée : ne matche AUCUN slug de municipalité (exclue).
      "qc-zonage-saint-hippolyte-affectations-arcgis",
      "autre-collection",
    ]);
    const body = await request({ store, db: makeDb([]), fetchImpl });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l4Zonage).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "geo",
    });
    expect(valleyfield.l5Lots).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "geo",
    });

    // saint-hippolyte : lots servis live, zonage NON (variante suffixée ≠ slug).
    const hippolyte = cityOf(body, "saint-hippolyte");
    expect(hippolyte.l5Lots).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "geo",
    });
    expect(hippolyte.l4Zonage.served).toBe(false);
    expect(hippolyte.l4Zonage.state).not.toBe("verified");

    // Totals refléteront le listing live (1 zonage, 2 lots ici).
    expect(body.totals.l4Zonage).toBe(1);
    expect(body.totals.l5Lots).toBe(2);

    // UNE seule requête listing pour les ~1104 villes (jamais per-city).
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches the live listing across coverage requests (TTL)", async () => {
    const store = makeMemStore();
    const fetchImpl = listingFetch(["qc-lots-saint-hippolyte"]);
    const app = sourceCoverageRoute({
      store,
      db: makeDb([]),
      now: NOW,
      fetchImpl,
    });

    const res1 = await app.request("/api/source/coverage");
    const res2 = await app.request("/api/source/coverage");
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to local PG (honest degrade) when the geo listing is unreachable", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [],
      [
        {
          citySlug: "salaberry-de-valleyfield",
          currentVersions: 5,
          withGeometry: 5,
          lastKnownFrom: RECENT,
        },
      ],
      [],
    ]);
    const body = await request({ store, db, fetchImpl: offlineFetch });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    // Servi via le store local malgré geo down (dégradé, pas cassé).
    expect(valleyfield.l4Zonage).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "local",
    });
    // Rien de local ni de live → pas de vert fabriqué.
    const hippolyte = cityOf(body, "saint-hippolyte");
    expect(hippolyte.l5Lots.served).toBe(false);
  });

  // ── Signaux extraits (projection PG + part avec citation vérifiable) ────────

  it("exposes the signals layer with citation share from the graph projection", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 40,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
      [
        {
          citySlug: "salaberry-de-valleyfield",
          signalCount: 12,
          withCitation: 9,
          lastCreatedAt: RECENT,
        },
      ],
    ]);
    const body = await request({ store, db });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.signals).toMatchObject({
      state: "verified",
      count: 12,
      withCitation: 9,
    });
    expect(body.totals.signals).toBe(1);
  });

  it("signals: structured city without projected signals is declared, unknown city absent", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 40,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
      [], // aucun signal projeté
    ]);
    const body = await request({ store, db });

    // L2 substantié mais 0 signal projeté → declared (pas un faux vert).
    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.signals.state).toBe("declared");
    expect(valleyfield.signals.count).toBe(0);

    // Ville sans rien → absent.
    const brossard = cityOf(body, "brossard");
    expect(brossard.signals.state).toBe("absent");
  });

  it("keeps worstStatus on the core L1/L2/L4/L5 chain (annex layers do not repaint the map)", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "salaberry-de-valleyfield",
        source: "conseils-municipaux",
        status: "graphified",
        lastRunAt: RECENT.toISOString(),
      }),
    );
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 40,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
      [], // signaux non projetés → cellule declared
    ]);
    const fetchImpl = listingFetch([
      "qc-zonage-salaberry-de-valleyfield",
      "qc-lots-salaberry-de-valleyfield",
    ]);
    const body = await request({ store, db, fetchImpl });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.signals.state).toBe("declared");
    // Chaîne cœur toute verte → la ville reste verte sur la carte.
    expect(valleyfield.worstStatus).toBe("verified");
  });

  // ── Prochain gain marginal (D7) sur les flags « servi » corrigés ───────────

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

  it("clears nextMarginalGain once the live listing proves zonage+lots served", async () => {
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
      [],
      [],
    ]);
    const fetchImpl = listingFetch([
      "qc-zonage-salaberry-de-valleyfield",
      "qc-lots-salaberry-de-valleyfield",
    ]);
    const body = await request({ store, db, fetchImpl });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l4Zonage.served).toBe(true);
    expect(valleyfield.l5Lots.served).toBe(true);
    // Plus de complétion « cheap » à réclamer : le zonage/lots sont déjà servis.
    expect(valleyfield.nextMarginalGain).toBeNull();
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
      fetchImpl: offlineFetch,
    });

    const res = await app.request("/api/source/coverage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoverageResponse;
    expect(body.totals.cities).toBe(body.cities.length);
    expect(cityOf(body, "brossard").l1Raw.state).toBe("verified");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Détail grilles par ville (lazy, live geo)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/source/coverage/:citySlug/grilles", () => {
  function grillesApp(fetchImpl: typeof fetch): ReturnType<typeof sourceCoverageRoute> {
    return sourceCoverageRoute({
      store: makeMemStore(),
      now: NOW,
      fetchImpl,
    });
  }

  function itemsFetch(features: unknown[]): typeof fetch {
    return vi.fn(async () =>
      new Response(JSON.stringify({ type: "FeatureCollection", features }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  }

  it("counts zones carrying a grille PDF or real normes (partial → declared)", async () => {
    const fetchImpl = itemsFetch([
      { properties: { zone_code: "H-1", URL_GRILLE: "https://x/grille-h1.pdf" } },
      { properties: { zone_code: "H-2", usages_permis: "h1;h2", densite: "35" } },
      { properties: { zone_code: "C-1" } }, // ni grille ni normes
    ]);
    const app = grillesApp(fetchImpl);
    const res = await app.request(
      "/api/source/coverage/saint-hippolyte/grilles",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CityGrillesResponse;
    expect(body).toMatchObject({
      citySlug: "saint-hippolyte",
      available: true,
      zoneCount: 3,
      zonesWithGrille: 1,
      zonesWithNormes: 1,
      covered: 2,
      state: "declared",
    });
  });

  it("all zones covered → verified; none → absent (honest, no fabricated green)", async () => {
    const covered = itemsFetch([
      { properties: { zone_code: "H-1", grillePdfUrl: "https://x/1.pdf" } },
      { properties: { zone_code: "H-2", usages: ["h1"] } },
    ]);
    const bare = itemsFetch([
      { properties: { zone_code: "H-1" } },
      { properties: { zone_code: "H-2" } },
    ]);

    const resCovered = await grillesApp(covered).request(
      "/api/source/coverage/ville-a/grilles",
    );
    expect(((await resCovered.json()) as CityGrillesResponse).state).toBe(
      "verified",
    );

    const resBare = await grillesApp(bare).request(
      "/api/source/coverage/ville-b/grilles",
    );
    const bareBody = (await resBare.json()) as CityGrillesResponse;
    expect(bareBody.state).toBe("absent");
    expect(bareBody.covered).toBe(0);
  });

  it("collection 404 → available with zero zones (absent), geo unreachable → available:false", async () => {
    const notFound = vi.fn(async () =>
      new Response("{}", { status: 404 }),
    ) as unknown as typeof fetch;
    const res404 = await grillesApp(notFound).request(
      "/api/source/coverage/ville-sans-zonage/grilles",
    );
    expect(res404.status).toBe(200);
    expect((await res404.json()) as CityGrillesResponse).toMatchObject({
      available: true,
      zoneCount: 0,
      state: "absent",
    });

    const resDown = await grillesApp(offlineFetch).request(
      "/api/source/coverage/ville-x/grilles",
    );
    expect(resDown.status).toBe(200);
    expect((await resDown.json()) as CityGrillesResponse).toMatchObject({
      citySlug: "ville-x",
      available: false,
    });
  });

  it("caches the per-city result (TTL) and rejects malformed slugs", async () => {
    const fetchImpl = itemsFetch([{ properties: { zone_code: "H-1" } }]);
    const app = grillesApp(fetchImpl);
    await app.request("/api/source/coverage/ville-a/grilles");
    await app.request("/api/source/coverage/ville-a/grilles");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const bad = await app.request(
      "/api/source/coverage/Ville%20Pas%20Slug/grilles",
    );
    expect(bad.status).toBe(404);
  });
});
