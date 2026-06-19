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
 *   - extractZoneCode : priorité NUM_ZONE > NO_ZONAGE > CODE_MUN, URL_GRILLE
 *   - pullGeoOgc : intégration villes + gestion erreur ville inconnue
 *   - pullGeoOgc (override) : zoneCollectionOverrides → collection exacte
 */
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client.js";
import type pg from "pg";
import {
  normalizeNoLot,
  normalizeZoneCode,
  lotCanonicalId,
  zoneCanonicalId,
  extractZoneCode,
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

// ─── extractZoneCode ──────────────────────────────────────────────────────────

describe("extractZoneCode", () => {
  it("NUM_ZONE a la priorité sur NO_ZONAGE et CODE_MUN", () => {
    expect(
      extractZoneCode({ NUM_ZONE: "RA-1", NO_ZONAGE: "Z-99", CODE_MUN: "XX" }),
    ).toBe("RA-1");
  });

  it("NO_ZONAGE utilisé si NUM_ZONE absent", () => {
    expect(
      extractZoneCode({ NO_ZONAGE: "Z-42", CODE_MUN: "XX" }),
    ).toBe("Z-42");
  });

  it("CODE_MUN utilisé si NUM_ZONE et NO_ZONAGE absents", () => {
    expect(
      extractZoneCode({ CODE_MUN: "RCU-01" }),
    ).toBe("RCU-01");
  });

  it("repli sur featureId si aucun attribut", () => {
    expect(extractZoneCode({}, "feature-123")).toBe("feature-123");
  });

  it("retourne null si rien trouvé", () => {
    expect(extractZoneCode({})).toBeNull();
  });

  it("ignore les valeurs vides / null", () => {
    expect(
      extractZoneCode({ NUM_ZONE: "", NO_ZONAGE: null, CODE_MUN: "MRC-02" }),
    ).toBe("MRC-02");
  });
});

// ─── pullGeoOgc (zoneCollectionOverrides) ────────────────────────────────────

describe("pullGeoOgc avec zoneCollectionOverrides", () => {
  it("tire la collection exacte de l'override (pas de catalogue zones)", async () => {
    // Catalogue lots seulement — si on touchait aux zones du catalogue, le test échouerait
    const catalogueLots = {
      collections: [{ id: "qc-lots-mont-tremblant" }],
    };
    const zonePage: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 2,
      numberReturned: 2,
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-74.6, 46.1], [-74.5, 46.1], [-74.5, 46.2], [-74.6, 46.2], [-74.6, 46.1]]],
          },
          properties: { NUM_ZONE: "RA-1" },
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-74.7, 46.1], [-74.6, 46.1], [-74.6, 46.2], [-74.7, 46.2], [-74.7, 46.1]]],
          },
          properties: { NUM_ZONE: "RA-2" },
        },
      ],
    };

    // Appels fetch attendus :
    // 1. GET /collections (catalogue lots — pullLots=false, donc PAS de catalogue lots)
    //    Avec override et pullLots=false : 0 appel catalogue ; 1 seul appel items zone
    // pullLots=false → pas de GET catalogue lots
    // zoneCollectionOverrides fourni → pas de GET catalogue zones
    // → 1 seul appel : GET /collections/qc-zonage-mont-tremblant-arcgis/items
    const fetchCalls: string[] = [];
    const mockFetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      fetchCalls.push(urlStr);
      return new Response(JSON.stringify(zonePage), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query: queryMock, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
    const db = makeMockDb();

    const results = await pullGeoOgc(db, pool, ["mont-tremblant"], {
      fetchImpl: mockFetch,
      pullLots: false,
      pullZones: true,
      zoneCollectionOverrides: {
        "mont-tremblant": "qc-zonage-mont-tremblant-arcgis",
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.zonesUpserted).toBe(2);
    expect(results[0]!.errors).toHaveLength(0);

    // L'URL tirée doit cibler exactement la collection d'override
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain("qc-zonage-mont-tremblant-arcgis");
    // Pas de catalogue général
    expect(fetchCalls[0]).not.toContain("/collections?");
  });

  it("lit NUM_ZONE et l'inscrit comme code_affiche normalisé", async () => {
    const zonePage: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 1,
      numberReturned: 1,
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-74.6, 46.1], [-74.5, 46.1], [-74.5, 46.2], [-74.6, 46.2], [-74.6, 46.1]]],
          },
          properties: { NUM_ZONE: "  ra-5  " }, // doit être normalisé en "RA-5"
        },
      ],
    };

    const mockFetch = (async () =>
      new Response(JSON.stringify(zonePage), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query: queryMock, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
    const db = makeMockDb();

    await pullGeoOgc(db, pool, ["mont-tremblant"], {
      fetchImpl: mockFetch,
      pullLots: false,
      pullZones: true,
      zoneCollectionOverrides: {
        "mont-tremblant": "qc-zonage-mont-tremblant-arcgis",
      },
    });

    const selectCall = queryMock.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("SELECT id FROM zone_versions"),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall![1]).toContain("RA-5");
  });

  it("conserve URL_GRILLE dans l'evidence (rimouski NO_ZONAGE)", async () => {
    const zonePage: OgcFeatureCollection = {
      type: "FeatureCollection",
      numberMatched: 1,
      numberReturned: 1,
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-68.5, 48.4], [-68.4, 48.4], [-68.4, 48.5], [-68.5, 48.5], [-68.5, 48.4]]],
          },
          properties: {
            NO_ZONAGE: "H-1",
            URL_GRILLE: "https://example.com/grille-H-1.pdf",
          },
        },
      ],
    };

    const mockFetch = (async () =>
      new Response(JSON.stringify(zonePage), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query: queryMock, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
    const db = makeMockDb();

    await pullGeoOgc(db, pool, ["rimouski"], {
      fetchImpl: mockFetch,
      pullLots: false,
      pullZones: true,
      zoneCollectionOverrides: {
        rimouski: "qc-zonage-rimouski",
      },
    });

    // Trouver l'appel INSERT avec evidence JSONB ($9)
    const insertCall = queryMock.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("INSERT INTO zone_versions"),
    );
    expect(insertCall).toBeDefined();
    // Les paramètres de l'INSERT avec geom sont : [canonId, citySlug, codeNorm, kind,
    //   today, now, geomJson, rawRef, evidenceJson]
    // L'evidence est donc à l'index 1 du tableau params (args[1] est le tableau de params)
    const params = insertCall![1] as unknown[];
    // Trouver le paramètre qui est du JSON avec "urlGrille"
    const evidenceParam = params.find(
      (p) => typeof p === "string" && p.includes("urlGrille"),
    ) as string | undefined;
    expect(evidenceParam).toBeDefined();
    const evidence = JSON.parse(evidenceParam!) as Array<Record<string, unknown>>;
    expect(evidence[0]!["urlGrille"]).toBe("https://example.com/grille-H-1.pdf");
  });
});
