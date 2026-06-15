/**
 * Tests du CadastreAllegeAdapter (P0-A).
 *
 * Tous les tests utilisent des fixtures statiques — AUCUN appel réseau en CI.
 * Les fixtures sont capturées depuis l'API MELCC/MRNF live (2026-06-14).
 */

import { describe, it, expect, vi } from "vitest";
import type { FetchLike } from "./geo-fetch-utils.js";
import {
  CadastreAllegeAdapter,
  buildCadastreQueryUrl,
  buildCadastreCountUrl,
  normalizeCadastreFeature,
  CADASTRE_ALLEGE_BASE_URL,
  CADASTRE_ALLEGE_ADAPTER_VERSION,
} from "./cadastre-allege.js";
import {
  CADASTRE_DELSON_FIXTURE_GEOJSON,
  CADASTRE_PAGE1_FIXTURE,
  CADASTRE_PAGE2_FIXTURE,
  DELSON_BBOX,
  SAINTE_CATHERINE_BBOX,
} from "./cadastre-allege.fixture.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Crée un mock FetchLike qui retourne les réponses en séquence. */
function makeMockFetch(responses: unknown[]): FetchLike {
  let callIndex = 0;
  return vi.fn((_url: string, _init?: unknown) => {
    const response = responses[callIndex++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (_name: string) => "application/geo+json" },
      text: () => Promise.resolve(JSON.stringify(response)),
      arrayBuffer: () =>
        Promise.resolve(
          new TextEncoder().encode(JSON.stringify(response)).buffer,
        ),
    });
  }) as unknown as FetchLike;
}

/** Crée un mock FetchLike qui retourne une erreur HTTP. */
function makeErrorFetch(status: number): FetchLike {
  return vi.fn((_url: string, _init?: unknown) =>
    Promise.resolve({
      ok: false,
      status,
      headers: { get: (_name: string) => null },
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }),
  ) as unknown as FetchLike;
}

// ─── Tests buildCadastreQueryUrl ──────────────────────────────────────────

describe("buildCadastreQueryUrl", () => {
  it("contient les paramètres essentiels", () => {
    const url = buildCadastreQueryUrl(
      CADASTRE_ALLEGE_BASE_URL,
      DELSON_BBOX,
      0,
      2000,
    );
    expect(url).toContain("/query?");
    expect(url).toContain("geometryType=esriGeometryEnvelope");
    expect(url).toContain("inSR=4326");
    expect(url).toContain("outSR=4326");
    expect(url).toContain("f=geojson");
    expect(url).toContain("returnGeometry=true");
    expect(url).toContain("resultOffset=0");
    expect(url).toContain("resultRecordCount=2000");
  });

  it("encode la bbox dans le paramètre geometry", () => {
    const url = buildCadastreQueryUrl(
      CADASTRE_ALLEGE_BASE_URL,
      DELSON_BBOX,
      0,
      100,
    );
    expect(url).toContain("geometry=");
    expect(decodeURIComponent(url)).toContain('"xmin":-73.56');
    expect(decodeURIComponent(url)).toContain('"ymin":45.36');
  });

  it("gère la pagination via resultOffset", () => {
    const url = buildCadastreQueryUrl(
      CADASTRE_ALLEGE_BASE_URL,
      SAINTE_CATHERINE_BBOX,
      2000,
      2000,
    );
    expect(url).toContain("resultOffset=2000");
  });
});

// ─── Tests buildCadastreCountUrl ──────────────────────────────────────────

describe("buildCadastreCountUrl", () => {
  it("contient returnCountOnly=true", () => {
    const url = buildCadastreCountUrl(CADASTRE_ALLEGE_BASE_URL, DELSON_BBOX);
    expect(url).toContain("returnCountOnly=true");
    expect(url).toContain("f=json");
  });
});

// ─── Tests normalizeCadastreFeature ───────────────────────────────────────

describe("normalizeCadastreFeature", () => {
  it("normalise un lot valide", () => {
    const feature = CADASTRE_DELSON_FIXTURE_GEOJSON.features[0];
    const lot = normalizeCadastreFeature(feature);
    expect(lot).not.toBeNull();
    expect(lot?.no_lot).toBe("6 057 912");
    expect(lot?.objectid).toBe(21621);
    expect(lot?.geometry.type).toBe("Polygon");
  });

  it("retourne null pour un feature sans NO_LOT", () => {
    const feature = {
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    };
    expect(normalizeCadastreFeature(feature)).toBeNull();
  });

  it("retourne null pour un feature avec NO_LOT vide", () => {
    const feature = {
      type: "Feature",
      properties: { NO_LOT: "   ", OBJECTID: 1 },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    };
    expect(normalizeCadastreFeature(feature)).toBeNull();
  });

  it("retourne null pour un feature sans géométrie", () => {
    const feature = {
      type: "Feature",
      properties: { NO_LOT: "1 234 567", OBJECTID: 1 },
      geometry: null,
    };
    expect(normalizeCadastreFeature(feature)).toBeNull();
  });

  it("retourne null pour null en entrée", () => {
    expect(normalizeCadastreFeature(null)).toBeNull();
  });

  it("retourne null pour un non-Feature", () => {
    expect(normalizeCadastreFeature({ type: "Point" })).toBeNull();
  });

  it("normalise les 3 lots du fixture Delson", () => {
    const lots = CADASTRE_DELSON_FIXTURE_GEOJSON.features.map(
      normalizeCadastreFeature,
    );
    expect(lots).toHaveLength(3);
    expect(lots.every((l) => l !== null)).toBe(true);
    expect(lots[0]?.no_lot).toBe("6 057 912");
    expect(lots[1]?.no_lot).toBe("2 095 168");
    expect(lots[2]?.no_lot).toBe("4 138 886");
  });
});

// ─── Tests CadastreAllegeAdapter ─────────────────────────────────────────

describe("CadastreAllegeAdapter", () => {
  it("expose les propriétés kind, city, version", () => {
    const adapter = new CadastreAllegeAdapter({
      city: "delson",
      bbox: DELSON_BBOX,
    });
    expect(adapter.kind).toBe("cadastre-allege");
    expect(adapter.city).toBe("delson");
    expect(adapter.version).toBe(CADASTRE_ALLEGE_ADAPTER_VERSION);
  });

  it("list() yields un seul RawDocumentRef avec city + url", async () => {
    const adapter = new CadastreAllegeAdapter({
      city: "delson",
      bbox: DELSON_BBOX,
    });
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs).toHaveLength(1);
    const ref = refs[0] as Record<string, unknown>;
    expect(ref["sourceKind"]).toBe("cadastre-allege");
    expect(ref["city"]).toBe("delson");
    expect(String(ref["url"])).toContain("query?");
    expect(ref["contentType"]).toBe("application/geo+json");
  });

  it("fetchAllLots() yield les lots d'une page unique (sans exceededTransferLimit)", async () => {
    const mockFetch = makeMockFetch([CADASTRE_DELSON_FIXTURE_GEOJSON]);
    const adapter = new CadastreAllegeAdapter({
      city: "delson",
      bbox: DELSON_BBOX,
      fetchImpl: mockFetch,
    });

    const lots: unknown[] = [];
    for await (const lot of adapter.fetchAllLots()) {
      lots.push(lot);
    }

    expect(lots).toHaveLength(3);
    const first = lots[0] as { no_lot: string; objectid: number };
    expect(first.no_lot).toBe("6 057 912");
    expect(first.objectid).toBe(21621);
  });

  it("fetchAllLots() pagine automatiquement si exceededTransferLimit=true", async () => {
    const mockFetch = makeMockFetch([
      CADASTRE_PAGE1_FIXTURE,
      CADASTRE_PAGE2_FIXTURE,
    ]);
    const adapter = new CadastreAllegeAdapter({
      city: "sainte-catherine",
      bbox: SAINTE_CATHERINE_BBOX,
      pageSize: 2,
      fetchImpl: mockFetch,
    });

    const lots: unknown[] = [];
    for await (const lot of adapter.fetchAllLots()) {
      lots.push(lot);
    }

    expect(lots).toHaveLength(3); // 2 + 1
    // Vérifier que la 2e requête a resultOffset=2
    const fnMock = mockFetch as ReturnType<typeof vi.fn>;
    const calls = fnMock.mock.calls as Array<[string, ...unknown[]]>;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0]).toContain("resultOffset=2");
  });

  it("fetch() retourne un RawDocument valide avec body GeoJSON", async () => {
    const mockFetch = makeMockFetch([CADASTRE_DELSON_FIXTURE_GEOJSON]);
    const adapter = new CadastreAllegeAdapter({
      city: "delson",
      bbox: DELSON_BBOX,
      fetchImpl: mockFetch,
      now: () => new Date("2026-06-14T12:00:00Z"),
    });

    const ref = {
      sourceKind: "cadastre-allege" as const,
      city: "delson",
      url: "https://example.com/query",
      discoveredAt: "2026-06-14T12:00:00Z",
    };

    const doc = await adapter.fetch(ref);

    expect(doc.sourceKind).toBe("cadastre-allege");
    expect(doc.city).toBe("delson");
    expect(doc.contentType).toBe("application/geo+json");
    expect(doc.provenance.obtentionMode).toBe("api");
    expect(doc.provenance.fetchedViaObscura).toBe(false);

    const fc = JSON.parse(new TextDecoder().decode(doc.body)) as {
      type: string;
      features: unknown[];
    };
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(3);
  });

  it("fetchAllLots() lance SourceFetchError sur HTTP 503", async () => {
    const mockFetch = makeErrorFetch(503);
    const adapter = new CadastreAllegeAdapter({
      city: "delson",
      bbox: DELSON_BBOX,
      fetchImpl: mockFetch,
    });

    await expect(async () => {
      for await (const _ of adapter.fetchAllLots()) {
        // consomme
      }
    }).rejects.toThrow("HTTP 503");
  });

  it("hash() retourne une string sha256 hex", async () => {
    const mockFetch = makeMockFetch([CADASTRE_DELSON_FIXTURE_GEOJSON]);
    const adapter = new CadastreAllegeAdapter({
      city: "delson",
      bbox: DELSON_BBOX,
      fetchImpl: mockFetch,
    });

    const ref = {
      sourceKind: "cadastre-allege" as const,
      city: "delson",
      url: "https://example.com/query",
      discoveredAt: "2026-06-14T12:00:00Z",
    };
    const doc = await adapter.fetch(ref);
    const h = adapter.hash(doc);
    expect(typeof h).toBe("string");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
