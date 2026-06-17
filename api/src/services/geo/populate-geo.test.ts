/**
 * Tests du service populate-geo.ts (G2).
 *
 * ## Stratégie CI — 0 réseau réel, 0 Postgres
 *
 * Toutes les sources (@sentropic/geo, @sentropic/geo-sources-americas) sont
 * MOCKÉES via vi.mock(). La DB est mockée (pattern resolve-refs.test.ts).
 *
 * ## Ce qui est vérifié
 *
 * 1. Zones CKAN (via acquireCkanGeoJson mocké) → zonesUpserted=3 pour longueuil.
 * 2. Zones CKAN (via acquireCkanGeoJson mocké) → zonesUpserted=2 pour saguenay.
 * 3. Bornage STRICT : LOT_CITY_BBOXES définies pour DEFAULT_LOT_CITIES.
 * 4. populateLots=true  → lots upsertés pour les villes dans lotCitySlugs.
 * 5. populateLots=false → totalLotsUpserted=0.
 * 6. runResolution=true  → resolution définie.
 * 7. runResolution=false → resolution absente.
 * 8. Erreur sur une ville → citiesErrored=1.
 */
import { describe, it, expect, vi } from "vitest";
import type { Database } from "../../db/client.js";

// ─── Fixtures inline ──────────────────────────────────────────────────────────

const ZONE_GEO_POLYGON = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-73.502, 45.531],
      [-73.501, 45.531],
      [-73.501, 45.532],
      [-73.502, 45.532],
      [-73.502, 45.531],
    ],
  ],
};

// FeatureCollection mock pour acquireCkanGeoJson (longueuil → 3 zones)
const CKAN_FC_LONGUEUIL = {
  type: "FeatureCollection" as const,
  features: [
    { type: "Feature", properties: { Zonage: "H34-327 (VLO)" }, geometry: ZONE_GEO_POLYGON },
    { type: "Feature", properties: { Zonage: "H34-141 (VLO)" }, geometry: ZONE_GEO_POLYGON },
    { type: "Feature", properties: { Zonage: "P34-191 (VLO)" }, geometry: ZONE_GEO_POLYGON },
  ],
};

// FeatureCollection mock pour acquireCkanGeoJson (saguenay → 2 zones)
const CKAN_FC_SAGUENAY = {
  type: "FeatureCollection" as const,
  features: [
    { type: "Feature", properties: { no_zone: "1000" }, geometry: ZONE_GEO_POLYGON },
    { type: "Feature", properties: { no_zone: "2000" }, geometry: ZONE_GEO_POLYGON },
  ],
};

// AdminFeatureCollection mock pour crawlQcCadastreLots (2 lots)
const CADASTRE_FC = {
  type: "FeatureCollection" as const,
  features: [
    { type: "Feature", properties: { NO_LOT: "6 057 912" }, geometry: ZONE_GEO_POLYGON },
    { type: "Feature", properties: { NO_LOT: "2 095 168" }, geometry: ZONE_GEO_POLYGON },
  ],
};

// ─── Mock DB factory ──────────────────────────────────────────────────────────

function makeMockDb(): { db: Database; executeCount: number } {
  let executeCount = 0;

  const db = {
    execute: (_sqlTag: unknown): Promise<{ rows: unknown[] }> => {
      executeCount++;
      return Promise.resolve({ rows: [] });
    },
    select: (_fields: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: number): Promise<unknown[]> => Promise.resolve([]),
        }),
      }),
    }),
  } as unknown as Database;

  const proxy = new Proxy(
    { db, get executeCount() { return executeCount; } },
    {},
  );
  return proxy;
}

// ─── Mocks des modules ────────────────────────────────────────────────────────

// Mock de @sentropic/geo → acquireCkanGeoJson dispatche par URL
vi.mock("@sentropic/geo", () => ({
  acquireCkanGeoJson: vi.fn().mockImplementation(async (url: string) => {
    const makeProv = () => ({
      source: "mock",
      url,
      fetchedAt: new Date().toISOString(),
    });
    if (url.includes("longueuil")) {
      return { collection: CKAN_FC_LONGUEUIL, provenance: makeProv() };
    }
    if (url.includes("saguenay") || url.includes("sag_zonage")) {
      return { collection: CKAN_FC_SAGUENAY, provenance: makeProv() };
    }
    return {
      collection: { type: "FeatureCollection", features: [] },
      provenance: makeProv(),
    };
  }),
}));

// Mock de @sentropic/geo-sources-americas (2 manifestes minimalistes)
vi.mock("@sentropic/geo-sources-americas", () => ({
  QC_ZONAGE_CKAN_MANIFESTS: [
    {
      id: "ca-qc/zonage-longueuil",
      datasets: [
        {
          id: "qc-zonage-longueuil",
          url: "https://mock.dq.ca/longueuil/zonage.json",
          format: "geojson",
        },
      ],
    },
    {
      id: "ca-qc/zonage-saguenay",
      datasets: [
        {
          id: "qc-zonage-saguenay",
          url: "https://mock.dq.ca/saguenay/sag_zonage.geojson",
          format: "geojson",
        },
      ],
    },
  ],
  crawlQcCadastreLots: vi.fn().mockResolvedValue({
    collection: CADASTRE_FC,
    provenance: {
      url: "https://mock-cadastre/layer",
      fetchedAt: new Date().toISOString(),
      strategy: "bbox",
      pageSize: 1000,
      pages: 2,
    },
    recipeVersion: "0.1.0",
  }),
}));

// Mock de resolve-refs
vi.mock("./resolve-refs.js", () => ({
  resolveGeoRefsBatch: vi.fn().mockResolvedValue({
    total: 5,
    resolvedZones: 3,
    resolvedLots: 1,
    unresolvedZones: 1,
    unresolvedLots: 0,
  }),
}));

// ─── Import du module testé (APRÈS les mocks) ─────────────────────────────────

const { populateGeo, LOT_CITY_BBOXES, DEFAULT_LOT_CITIES } = await import("./populate-geo.js");
const { resolveGeoRefsBatch } = await import("./resolve-refs.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("populateGeo — zones CKAN via @sentropic/geo (longueuil)", () => {
  it("upserte 3 zones CKAN → zonesUpserted=3", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["longueuil"],
      populateLots: false,
      runResolution: false,
    });

    expect(result.citiesOk).toBe(1);
    expect(result.citiesErrored).toBe(0);
    expect(result.totalZonesUpserted).toBe(3);
    expect(result.byCity[0]?.zonesUpserted).toBe(3);
  });

  it("citySlugs sélective : seule longueuil traitée", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["longueuil"],
      populateLots: false,
      runResolution: false,
    });

    expect(result.citiesProcessed).toBe(1);
    expect(result.byCity[0]?.citySlug).toBe("longueuil");
  });
});

describe("populateGeo — zones CKAN via @sentropic/geo (saguenay)", () => {
  it("upserte 2 zones CKAN → zonesUpserted=2", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["saguenay"],
      populateLots: false,
      runResolution: false,
    });

    expect(result.citiesOk).toBe(1);
    expect(result.totalZonesUpserted).toBe(2);
  });
});

describe("populateGeo — lots (bornage STRICT)", () => {
  it("LOT_CITY_BBOXES définies pour DEFAULT_LOT_CITIES (bornage STRICT)", () => {
    for (const slug of DEFAULT_LOT_CITIES) {
      const bbox = LOT_CITY_BBOXES[slug];
      expect(bbox, `bbox manquante pour ${slug}`).toBeDefined();
      if (bbox) {
        expect(bbox.minLon).toBeLessThan(bbox.maxLon);
        expect(bbox.minLat).toBeLessThan(bbox.maxLat);
        expect(bbox.minLon).toBeGreaterThan(-80);
        expect(bbox.maxLon).toBeLessThan(-60);
        expect(bbox.minLat).toBeGreaterThan(44);
        expect(bbox.maxLat).toBeLessThan(55);
      }
    }
  });

  it("lots peuplés pour longueuil (dans lotCitySlugs) → lotsUpserted=2", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["longueuil"],
      populateLots: true,
      lotCitySlugs: ["longueuil"],
      runResolution: false,
    });

    expect(result.totalLotsUpserted).toBe(2);
    expect(result.byCity[0]?.lotsUpserted).toBe(2);
  });

  it("populateLots=false → totalLotsUpserted=0", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["longueuil"],
      populateLots: false,
      runResolution: false,
    });

    expect(result.totalLotsUpserted).toBe(0);
  });

  it("ville hors lotCitySlugs → pas de lots", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["saguenay"],
      populateLots: true,
      lotCitySlugs: ["longueuil"],
      runResolution: false,
    });

    expect(result.totalLotsUpserted).toBe(0);
    expect(result.byCity[0]?.lotsUpserted).toBe(0);
  });
});

describe("populateGeo — résolution géo", () => {
  it("runResolution=true → resolution définie (0 signaux en DB mock)", async () => {
    const { db } = makeMockDb();

    vi.mocked(resolveGeoRefsBatch).mockClear();

    const result = await populateGeo(db, {
      citySlugs: ["longueuil"],
      populateLots: false,
      runResolution: true,
    });

    // DB mock retourne rows=[] → fetchSignalInputsForCity retourne []
    // → inputs.length=0 → resolveGeoRefsBatch NON appelé (shortcut)
    expect(result.byCity[0]?.resolution).toBeDefined();
    expect(result.byCity[0]?.resolution?.total).toBe(0);
  });

  it("runResolution=false → résolution absente (undefined)", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["longueuil"],
      populateLots: false,
      runResolution: false,
    });

    expect(result.byCity[0]?.resolution).toBeUndefined();
  });
});

describe("populateGeo — résilience erreur", () => {
  it("erreur acquireCkanGeoJson → citiesErrored=1, error dans byCity", async () => {
    const { acquireCkanGeoJson: mockAcquire } = await import("@sentropic/geo");

    vi.mocked(mockAcquire).mockRejectedValueOnce(
      new Error("Service CKAN temporairement indisponible"),
    );

    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["longueuil"],
      populateLots: false,
      runResolution: false,
    });

    expect(result.citiesErrored).toBe(1);
    expect(result.citiesOk).toBe(0);
    expect(result.byCity[0]?.error).toContain("temporairement");
  });
});

describe("populateGeo — bilan", () => {
  it("byCity contient une entrée par ville traitée", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      citySlugs: ["longueuil"],
      populateLots: false,
      runResolution: false,
    });

    expect(result.byCity).toHaveLength(1);
    expect(result.byCity[0]?.citySlug).toBe("longueuil");
  });

  it("toutes villes des manifestes traitées si citySlugs absent", async () => {
    const { db } = makeMockDb();

    const result = await populateGeo(db, {
      populateLots: false,
      runResolution: false,
    });

    // 2 manifestes mockés (longueuil + saguenay) = 2 villes
    expect(result.citiesProcessed).toBe(2);
  });
});
