/**
 * Reader geo service tests (lot I-1B, converged-geo-mesh r3 §2).
 * fetchImpl is fully mocked — no real network, no Postgres.
 */
import { describe, expect, it } from "vitest";
import {
  GEO_OPERATIONS_TRIGGER_BASKET_CONSENT,
  GEO_READER_BBOX_REQUIRED_ABOVE,
  GEO_READER_MAX_BYTES,
  GeoItemsRefusal,
  createGeoReadOperation,
  filterServedCities,
  listReaderCities,
  readReaderCollectionItems,
  readerGeoPilotCity,
  type ReaderGeoDeps,
} from "./reader-geo.js";

const CC_BY_4 = "Creative Commons Attribution 4.0 International";
const PILOT = "qc-zonage-gatineau-affectations-territoire";

const LISTING = {
  collections: [
    {
      id: PILOT,
      license: { title: CC_BY_4, href: "https://creativecommons.org/licenses/by/4.0/" },
      rights: { profile: "open", licenseStatus: "explicit" },
    },
    { id: "qc-zonage-salaberry-de-valleyfield", license: { title: "Unknown license" } },
    {
      id: "qc-zonage-laval-sad-centre-ville",
      license: { title: CC_BY_4 },
      rights: { profile: "open", licenseStatus: "explicit" },
    },
    { id: "qc-lots-delson", license: { title: "Unknown license" } },
    { id: "qc-zoning-events-candiac", license: { title: "Unknown license" } },
  ],
};

/** Real pilot-city zones: Gatineau polygons on the served-field keys. */
const GATINEAU_ITEMS = {
  type: "FeatureCollection",
  numberMatched: 2,
  numberReturned: 2,
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-75.7, 45.45],
            [-75.69, 45.45],
            [-75.69, 45.46],
            [-75.7, 45.46],
            [-75.7, 45.45],
          ],
        ],
      },
      properties: {
        ABREVIATION: "R-1",
        DESCRIPTION: "Affectation résidentielle",
        MUNID: "81017",
        TYPE: "Résidentiel",
        name: "Zone R-1",
        geoId: "gatineau-r-1",
        adresse: "123 rue Principale",
        code_postal: "J8X 1A1",
        code_postal_precision: "exact",
        extrait_brut: "M. Tremblay demande une dérogation…",
        unknown_future_field: "dropped",
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-75.71, 45.44],
            [-75.7, 45.44],
            [-75.7, 45.45],
            [-75.71, 45.45],
            [-75.71, 45.44],
          ],
        ],
      },
      properties: {
        ABREVIATION: "C-2",
        DESCRIPTION: "Affectation commerciale",
        MUNID: "81017",
        TYPE: "Commercial",
        name: "Zone C-2",
        geoId: "gatineau-c-2",
      },
    },
  ],
};

function makeFetch(options?: { itemsStatus?: number; items?: unknown }): {
  fn: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/collections?")) {
      return new Response(JSON.stringify(LISTING), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(options?.items ?? GATINEAU_ITEMS), {
      status: options?.itemsStatus ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const BASE_DEPS = (fetchImpl: typeof fetch): ReaderGeoDeps => ({
  fetchImpl,
  baseUrl: "https://geo.example",
  contractEnv: {},
  listCitiesImpl: async () => [
    { citySlug: "gatineau", zoneCount: 177, lotCount: 0, signalCount: 0 },
    { citySlug: "salaberry-de-valleyfield", zoneCount: 42, lotCount: 0, signalCount: 0 },
    { citySlug: "laval", zoneCount: 9, lotCount: 0, signalCount: 0 },
  ],
});

describe("geo consent classification (I2-partage line, recorded for rebase)", () => {
  it("marks the geo operations as non-triggers of the basket consent", () => {
    expect(GEO_OPERATIONS_TRIGGER_BASKET_CONSENT).toBe(false);
    expect(readerGeoPilotCity()).toBe("gatineau");
  });
});

describe("filterServedCities", () => {
  it("keeps only cities covered by a served record", () => {
    const cities = filterServedCities([
      { citySlug: "gatineau", zoneCount: 177, lotCount: 0, signalCount: 0 },
      { citySlug: "salaberry-de-valleyfield", zoneCount: 42, lotCount: 0, signalCount: 0 },
    ]);
    expect(cities.map((city) => city.citySlug)).toEqual(["gatineau"]);
    expect(cities[0]?.collections).toEqual([PILOT]);
  });
});

describe("geo.cities.v1", () => {
  it("returns the served pilot city with its collections", async () => {
    const { fn } = makeFetch();
    const body = await listReaderCities(BASE_DEPS(fn));
    expect(body.ok).toBe(true);
    expect(body.cities.map((city) => city.citySlug)).toEqual(["gatineau"]);
    expect(body.cities[0]).toMatchObject({ zoneCount: 177, collections: [PILOT] });
    expect(JSON.stringify(body)).not.toContain("reader-");
  });
});

describe("geo.collection-items.v1 served (real Gatineau zones)", () => {
  it("proxies pilot zones with geometries through the allowlist", async () => {
    const { fn, calls } = makeFetch();
    const body = await readReaderCollectionItems(BASE_DEPS(fn), PILOT, { limit: 10 });
    expect(body.type).toBe("FeatureCollection");
    expect(body.collectionId).toBe(PILOT);
    expect(body.licenseId).toBe("cc-by-4.0");
    expect(body.numberMatched).toBe(2);
    expect(body.numberReturned).toBe(2);
    expect(body.truncated).toBe(false);
    expect(body.contract).toMatchObject({ status: "missing source" });
    const first = body.features[0]!;
    expect(first.geometry).toMatchObject({ type: "Polygon" });
    expect(first.properties["DESCRIPTION"]).toBe("Affectation résidentielle");
    expect(first.properties["MUNID"]).toBe("81017");
    for (const banned of ["adresse", "code_postal", "code_postal_precision", "extrait_brut", "unknown_future_field"]) {
      expect(first.properties).not.toHaveProperty(banned);
    }
    expect(JSON.stringify(body)).not.toContain("rue Principale");
    expect(JSON.stringify(body)).not.toContain("Tremblay");
    expect(calls.some((url) => url.includes("/items?"))).toBe(true);
  });

  it("signals truncation when the upstream matched more than returned", async () => {
    const { fn } = makeFetch({
      items: { ...GATINEAU_ITEMS, numberMatched: 1000, numberReturned: 2 },
    });
    const body = await readReaderCollectionItems(BASE_DEPS(fn), PILOT, { limit: 10 });
    expect(body.numberMatched).toBe(1000);
    expect(body.numberReturned).toBe(2);
    expect(body.truncated).toBe(true);
  });

  it("caps an upstream page that returns more features than limit", async () => {
    const extra = Array.from({ length: 5 }, (_, index) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-75.7, 45.45] },
      properties: { DESCRIPTION: `zone-${index}`, MUNID: "81017" },
    }));
    const { fn } = makeFetch({
      items: { type: "FeatureCollection", numberMatched: 5, numberReturned: 5, features: extra },
    });
    const body = await readReaderCollectionItems(BASE_DEPS(fn), PILOT, { limit: 2 });
    expect(body.numberMatched).toBe(5);
    expect(body.numberReturned).toBe(2);
    expect(body.features).toHaveLength(2);
    expect(body.truncated).toBe(true);
  });

  it("applies the 1 MiB byte cap on the live path", async () => {
    const big = Array.from({ length: 8 }, (_, index) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-75.7, 45.45] },
      properties: { DESCRIPTION: `zone-${index}-${"x".repeat(300 * 1024)}`, MUNID: "81017" },
    }));
    const { fn } = makeFetch({
      items: { type: "FeatureCollection", numberMatched: big.length, numberReturned: big.length, features: big },
    });
    const body = await readReaderCollectionItems(BASE_DEPS(fn), PILOT, {
      limit: 1000,
      bbox: "-75.8,45.4,-75.6,45.5",
    });
    expect(body.numberMatched).toBe(big.length);
    expect(body.numberReturned).toBeLessThan(big.length);
    expect(body.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(body.features), "utf8")).toBeLessThanOrEqual(GEO_READER_MAX_BYTES);
  });

  it("signals truncation when the local fallback holds more than limit", async () => {
    const local = Array.from({ length: 5 }, (_, index) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-75.7, 45.45] },
      properties: { DESCRIPTION: `zone-${index}`, MUNID: "81017" },
    }));
    const { fn } = makeFetch({ itemsStatus: 503 });
    const body = await readReaderCollectionItems(
      {
        ...BASE_DEPS(fn),
        localZoneResolver: async () => ({ type: "FeatureCollection", features: local }),
      },
      PILOT,
      { limit: 2 },
    );
    expect(body.numberMatched).toBe(5);
    expect(body.numberReturned).toBe(2);
    expect(body.features).toHaveLength(2);
    expect(body.truncated).toBe(true);
  });

  it("falls back to the local store through the same allowlist", async () => {
    const { fn } = makeFetch({ itemsStatus: 503 });
    const body = await readReaderCollectionItems(
      {
        ...BASE_DEPS(fn),
        localZoneResolver: async () => ({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-75.7, 45.45] },
              properties: {
                DESCRIPTION: "kept",
                adresse: "123 rue Principale",
                code_postal: "J8X 1A1",
                extrait_brut: "M. Tremblay demande une dérogation…",
              },
            },
          ],
        }),
      },
      PILOT,
      { limit: 10 },
    );
    expect(body.numberReturned).toBe(1);
    expect(body.features[0]?.properties["DESCRIPTION"]).toBe("kept");
    for (const banned of ["adresse", "code_postal", "extrait_brut"]) {
      expect(body.features[0]?.properties).not.toHaveProperty(banned);
    }
  });
});

describe("geo.collection-items.v1 refusals (zero upstream calls)", () => {
  it.each([
    ["qc-lots-delson", "not served"],
    ["qc-zoning-events-candiac", "not served"],
    ["qc-zonage-salaberry-de-valleyfield", "not covered"],
    ["qc-zonage-unknown-city", "not covered"],
    ["random-collection", "not served"],
  ])("refuses %s (%s) without any upstream call", async (id, status) => {
    const { fn, calls } = makeFetch();
    const failure = await readReaderCollectionItems(BASE_DEPS(fn), id, { limit: 10 }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(GeoItemsRefusal);
    expect((failure as GeoItemsRefusal).status).toBe(403);
    expect((failure as GeoItemsRefusal).body).toMatchObject({
      ok: false,
      error: "geo_governed_not_served",
      collectionId: id,
      status,
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses a high limit without bbox before any upstream call", async () => {
    const { fn, calls } = makeFetch();
    const failure = await readReaderCollectionItems(BASE_DEPS(fn), PILOT, {
      limit: GEO_READER_BBOX_REQUIRED_ABOVE + 1,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GeoItemsRefusal);
    expect((failure as GeoItemsRefusal).status).toBe(400);
    expect((failure as GeoItemsRefusal).body).toMatchObject({
      ok: false,
      error: "geo_bbox_required",
      collectionId: PILOT,
    });
    expect(calls).toHaveLength(0);
  });

  it("serves the same high limit with a bbox", async () => {
    const { fn, calls } = makeFetch();
    const body = await readReaderCollectionItems(BASE_DEPS(fn), PILOT, {
      limit: GEO_READER_BBOX_REQUIRED_ABOVE + 1,
      bbox: "-75.8,45.4,-75.6,45.5",
    });
    expect(body.numberReturned).toBe(2);
    const itemsCall = calls.find((url) => url.includes("/items?"));
    expect(itemsCall).toContain("bbox=");
    expect(itemsCall).not.toContain("adresse");
  });
});

describe("createGeoReadOperation dispatch", () => {
  it("answers both operations and closes unknown ones", async () => {
    const { fn } = makeFetch();
    const dispatch = createGeoReadOperation(BASE_DEPS(fn));
    const cities = (await dispatch("geo.cities.v1", {})) as { ok: boolean; cities: { citySlug: string }[] };
    expect(cities.cities.map((city) => city.citySlug)).toEqual(["gatineau"]);
    const items = (await dispatch("geo.collection-items.v1", {
      collectionId: PILOT,
      limit: 10,
    })) as { type: string };
    expect(items.type).toBe("FeatureCollection");
    await expect(dispatch("geo.read.v1", {})).rejects.toThrow("Capability unavailable");
  });
});
