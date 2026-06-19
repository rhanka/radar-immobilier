/**
 * Tests unitaires ogc-pull.ts
 *
 * Tous les appels réseau sont mockés — 0 réseau live en CI.
 * Tests couverts :
 *   - normalizeNoLot : suppression espaces, cas dégénérés
 *   - normalizeZoneCode : trim + uppercase, cas dégénérés
 *   - lotCanonicalId / zoneCanonicalId : format déterministe
 *   - fetchCollectionIds : filtre par prefix, parsing catalogue
 *   - fetchCollectionFeatures : pagination (2 pages), last page
 *   - upsertLotBatch : INSERT nouveau lot, UPDATE lot existant, skip NO_LOT vide
 *   - upsertZoneBatch : INSERT nouvelle zone, skip code vide
 *   - pullGeoOgc : intégration villes + gestion erreur ville inconnue
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Database } from "../../db/client.js";
import type pg from "pg";
import {
  normalizeNoLot,
  normalizeZoneCode,
  lotCanonicalId,
  zoneCanonicalId,
  fetchCollectionIds,
  fetchCollectionFeatures,
  upsertLotBatch,
  upsertZoneBatch,
  pullGeoOgc,
  type OgcFeature,
  type OgcCollectionsResponse,
  type OgcFeatureCollection,
} from "./ogc-pull.js";

// ─── Helpers fixtures ─────────────────────────────────────────────────────────

function makeFeature(noLot: string, withGeom = true): OgcFeature {
  return {
    type: "Feature",
    geometry: withGeom
      ? {
          type: "Polygon",
          coordinates: [
            [
              [-73.55, 45.39],
              [-73.54, 45.39],
              [-73.54, 45.40],
              [-73.55, 45.40],
              [-73.55, 45.39],
            ],
          ],
        }
      : null,
    properties: { NO_LOT: noLot },
  };
}

function makeZoneFeature(code: string, withGeom = true): OgcFeature {
  return {
    type: "Feature",
    geometry: withGeom
      ? {
          type: "Polygon",
          coordinates: [
            [
              [-73.55, 45.39],
              [-73.54, 45.39],
              [-73.54, 45.40],
              [-73.55, 45.40],
              [-73.55, 45.39],
            ],
          ],
        }
      : null,
    properties: { CODE_MUN: code },
  };
}

/** Crée un mock fetch qui répond avec des corps JSON séquentiels. */
function makeSequentialFetch(...bodies: unknown[]): typeof fetch {
  let callIndex = 0;
  return (async (_url: string | URL | Request) => {
    const body = bodies[callIndex++] ?? { collections: [], features: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/** Crée un pg.Pool mock. */
function makeMockPool(responses: {
  existing?: { rows: { id: string }[]; rowCount: number };
} = {}): pg.Pool {
  const client = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (
        typeof sql === "string" &&
        (sql.includes("SELECT id FROM lot_versions") ||
          sql.includes("SELECT id FROM zone_versions"))
      ) {
        return Promise.resolve(responses.existing ?? { rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: vi.fn(),
  };
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as pg.Pool;
}

/** Crée un Database drizzle mock minimal. */
function makeMockDb(): Database {
  return {} as unknown as Database;
}

// ─── normalizeNoLot ───────────────────────────────────────────────────────────

describe("normalizeNoLot", () => {
  it("supprime les espaces internes", () => {
    expect(normalizeNoLot("4 516 943")).toBe("4516943");
  });

  it("retourne la valeur sans espace inchangée", () => {
    expect(normalizeNoLot("4516943")).toBe("4516943");
  });

  it("retourne '' pour null/undefined", () => {
    expect(normalizeNoLot(null)).toBe("");
    expect(normalizeNoLot(undefined)).toBe("");
  });

  it("convertit en string", () => {
    expect(normalizeNoLot(12345)).toBe("12345");
  });
});

// ─── normalizeZoneCode ────────────────────────────────────────────────────────

describe("normalizeZoneCode", () => {
  it("uppercase + trim", () => {
    expect(normalizeZoneCode("  rcu-01  ")).toBe("RCU-01");
  });

  it("retourne '' pour null/undefined", () => {
    expect(normalizeZoneCode(null)).toBe("");
    expect(normalizeZoneCode(undefined)).toBe("");
  });
});

// ─── canonical ids ────────────────────────────────────────────────────────────

describe("lotCanonicalId", () => {
  it("format ogc:lots:<city>:<noLot>", () => {
    expect(lotCanonicalId("saint-eustache", "4516943")).toBe(
      "ogc:lots:saint-eustache:4516943",
    );
  });
});

describe("zoneCanonicalId", () => {
  it("format ogc:zones:<city>:<code>", () => {
    expect(zoneCanonicalId("sainte-catherine", "RCU-01")).toBe(
      "ogc:zones:sainte-catherine:RCU-01",
    );
  });
});

// ─── fetchCollectionIds ───────────────────────────────────────────────────────

describe("fetchCollectionIds", () => {
  it("filtre les collections par préfixe qc-lots-", async () => {
    const catalogue: OgcCollectionsResponse = {
      collections: [
        { id: "qc-lots-saint-eustache" },
        { id: "qc-lots-sainte-catherine" },
        { id: "qc-zonage-saint-eustache" },
        { id: "other-collection" },
      ],
    };
    const mockFetch = makeSequentialFetch(catalogue);
    const ids = await fetchCollectionIds(
      "https://api.geo.sent-tech.ca",
      "qc-lots-",
      mockFetch,
    );
    expect(ids).toEqual(["qc-lots-saint-eustache", "qc-lots-sainte-catherine"]);
  });

  it("retourne [] si le catalogue est vide", async () => {
    const mockFetch = makeSequentialFetch({ collections: [] });
    const ids = await fetchCollectionIds(
      "https://api.geo.sent-tech.ca",
      "qc-lots-",
      mockFetch,
    );
    expect(ids).toEqual([]);
  });

  it("lève une erreur si HTTP != 200", async () => {
    const mockFetch = (async () =>
      new Response(null, { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchCollectionIds("https://api.geo.sent-tech.ca", "qc-lots-", mockFetch),
    ).rejects.toThrow("HTTP 500");
  });
});

// ─── fetchCollectionFeatures ──────────────────────────────────────────────────

describe("fetchCollectionFeatures", () => {
  it("retourne tous les features d'une collection en une page", async () => {
    const page: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 2,
      numberReturned: 2,
      features: [makeFeature("111"), makeFeature("222")],
    };
    const mockFetch = makeSequentialFetch(page);
    const pages: OgcFeature[][] = [];
    for await (const p of fetchCollectionFeatures(
      "https://api.geo.sent-tech.ca",
      "qc-lots-saint-eustache",
      10,
      mockFetch,
    )) {
      pages.push(p);
    }
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
  });

  it("pagine correctement sur 2 pages (pageSize=2)", async () => {
    const page1: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 4,
      numberReturned: 2,
      features: [makeFeature("A1"), makeFeature("A2")],
    };
    const page2: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 4,
      numberReturned: 2,
      features: [makeFeature("B1"), makeFeature("B2")],
    };
    // Page 3 vide → arrêt
    const page3: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 4,
      numberReturned: 0,
      features: [],
    };
    const mockFetch = makeSequentialFetch(page1, page2, page3);
    const all: OgcFeature[] = [];
    for await (const p of fetchCollectionFeatures(
      "https://api.geo.sent-tech.ca",
      "qc-lots-saint-eustache",
      2,
      mockFetch,
    )) {
      all.push(...p);
    }
    expect(all).toHaveLength(4);
  });

  it("s'arrête quand numberReturned < pageSize", async () => {
    const page: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 3,
      numberReturned: 3, // < pageSize=10 → dernière page
      features: [makeFeature("X1"), makeFeature("X2"), makeFeature("X3")],
    };
    const mockFetch = makeSequentialFetch(page);
    const all: OgcFeature[] = [];
    for await (const p of fetchCollectionFeatures(
      "https://api.geo.sent-tech.ca",
      "qc-lots-saint-eustache",
      10,
      mockFetch,
    )) {
      all.push(...p);
    }
    expect(all).toHaveLength(3);
  });
});

// ─── upsertLotBatch ───────────────────────────────────────────────────────────

describe("upsertLotBatch", () => {
  it("INSERT quand le lot n'existe pas encore", async () => {
    const pool = makeMockPool({ existing: { rows: [], rowCount: 0 } });
    const db = makeMockDb();
    const features = [makeFeature("4516943")];
    const result = await upsertLotBatch(db, pool, "sainte-catherine", features);
    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("UPDATE quand le lot existe déjà (known_to IS NULL)", async () => {
    const pool = makeMockPool({
      existing: { rows: [{ id: "some-uuid" }], rowCount: 1 },
    });
    const db = makeMockDb();
    const features = [makeFeature("4516943")];
    const result = await upsertLotBatch(db, pool, "sainte-catherine", features);
    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("skip les features sans NO_LOT", async () => {
    const pool = makeMockPool({ existing: { rows: [], rowCount: 0 } });
    const db = makeMockDb();
    const features: OgcFeature[] = [
      { type: "Feature", geometry: null, properties: { NO_LOT: "" } },
      { type: "Feature", geometry: null, properties: {} },
    ];
    const result = await upsertLotBatch(db, pool, "sainte-catherine", features);
    expect(result.upserted).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it("normalise NO_LOT avec espaces avant upsert", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query: queryMock, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
    const db = makeMockDb();
    const features = [makeFeature("4 516 943")];
    await upsertLotBatch(db, pool, "saint-eustache", features);
    // Vérifie que le SELECT utilise le no_lot normalisé sans espaces
    const selectCall = queryMock.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("SELECT id FROM lot_versions"),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall![1]).toContain("4516943");
    expect(selectCall![1]).not.toContain(" ");
  });
});

// ─── upsertZoneBatch ──────────────────────────────────────────────────────────

describe("upsertZoneBatch", () => {
  it("INSERT quand la zone n'existe pas encore", async () => {
    const pool = makeMockPool({ existing: { rows: [], rowCount: 0 } });
    const db = makeMockDb();
    const features = [makeZoneFeature("RCU-01")];
    const result = await upsertZoneBatch(
      db,
      pool,
      "saint-eustache",
      "qc-zonage-saint-eustache",
      features,
    );
    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("skip les features sans code de zone", async () => {
    const pool = makeMockPool({ existing: { rows: [], rowCount: 0 } });
    const db = makeMockDb();
    const features: OgcFeature[] = [
      { type: "Feature", geometry: null, properties: {} },
    ];
    const result = await upsertZoneBatch(
      db,
      pool,
      "saint-eustache",
      "qc-zonage-saint-eustache",
      features,
    );
    expect(result.upserted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("normalise le code zone en uppercase", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query: queryMock, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
    const db = makeMockDb();
    const features: OgcFeature[] = [
      {
        type: "Feature",
        geometry: null,
        properties: { CODE_MUN: "  rcu-01  " },
      },
    ];
    await upsertZoneBatch(
      db,
      pool,
      "saint-eustache",
      "qc-zonage-saint-eustache",
      features,
    );
    const selectCall = queryMock.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("SELECT id FROM zone_versions"),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall![1]).toContain("RCU-01");
  });
});

// ─── pullGeoOgc ───────────────────────────────────────────────────────────────

describe("pullGeoOgc", () => {
  it("retourne une erreur pour une ville absente du catalogue", async () => {
    // Catalogue : seulement sainte-catherine, pas saint-eustache
    const catalogue = {
      collections: [
        { id: "qc-lots-sainte-catherine" },
        { id: "qc-zonage-sainte-catherine" },
      ],
    };
    const mockFetch = makeSequentialFetch(catalogue, catalogue);

    const pool = makeMockPool();
    const db = makeMockDb();

    const results = await pullGeoOgc(db, pool, ["saint-eustache"], {
      fetchImpl: mockFetch,
      pullLots: true,
      pullZones: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.errors).toHaveLength(1);
    expect(results[0]!.errors[0]).toContain("qc-lots-saint-eustache");
  });

  it("pull deux villes → deux résultats", async () => {
    const catalogue = {
      collections: [
        { id: "qc-lots-sainte-catherine" },
        { id: "qc-lots-saint-eustache" },
      ],
    };
    const page: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 1,
      numberReturned: 1,
      features: [makeFeature("1111111")],
    };
    // 1 catalogue (lots only, pullZones=false), puis 1 page par ville
    const mockFetch = makeSequentialFetch(catalogue, page, page);

    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query: queryMock, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
    const db = makeMockDb();

    const results = await pullGeoOgc(
      db,
      pool,
      ["sainte-catherine", "saint-eustache"],
      {
        fetchImpl: mockFetch,
        pullLots: true,
        pullZones: false,
      },
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.citySlug).toBe("sainte-catherine");
    expect(results[1]!.citySlug).toBe("saint-eustache");
    expect(results[0]!.lotsUpserted).toBe(1);
    expect(results[1]!.lotsUpserted).toBe(1);
  });
});
