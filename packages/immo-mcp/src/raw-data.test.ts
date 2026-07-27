import { describe, expect, it, vi } from "vitest";
import {
  citySlug,
  createRawDataSource,
  filterByBbox,
  filterLots,
  HttpRawDataSource,
  MockRawDataSource,
  normalizeZoneCode,
  type Bbox,
  type GeoFeature,
} from "./raw-data.js";

function feature(props: Record<string, unknown>, lon = -73.52, lat = 45.53): GeoFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon, lat],
          [lon + 0.002, lat],
          [lon + 0.002, lat + 0.002],
          [lon, lat + 0.002],
          [lon, lat],
        ],
      ],
    },
    properties: props,
  };
}

function fcResponse(features: GeoFeature[], extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ type: "FeatureCollection", features, ...extra }),
    { status: 200, headers: { "content-type": "application/geo+json" } },
  );
}

describe("raw-data helpers", () => {
  it("citySlug normalises accents, case and spaces", () => {
    expect(citySlug("Longueuil")).toBe("longueuil");
    expect(citySlug("  Salaberry de Valleyfield ")).toBe("salaberry-de-valleyfield");
    expect(citySlug("Trois-Rivières")).toBe("trois-rivieres");
  });

  it("citySlug folds ASCII and typographic apostrophes to the same slug", () => {
    expect(citySlug("L'Ange-Gardien")).toBe("lange-gardien");
    expect(citySlug("L’Ange-Gardien")).toBe("lange-gardien");
  });

  it("normalizeZoneCode mirrors the api normalisation", () => {
    expect(normalizeZoneCode("h-203")).toBe("H-203");
    expect(normalizeZoneCode("H – 203")).toBe("H-203");
    expect(normalizeZoneCode(" H-203 (ABC) ")).toBe("H-203");
  });

  it("filterByBbox keeps intersecting features and features without geometry", () => {
    const inside = feature({ id: "in" }, -73.52, 45.53);
    const outside = feature({ id: "out" }, -73.4, 45.6);
    const noGeom: GeoFeature = { type: "Feature", geometry: null, properties: { id: "ng" } };
    const bbox: Bbox = [-73.53, 45.52, -73.51, 45.54];
    const kept = filterByBbox([inside, outside, noGeom], bbox);
    expect(kept.map((f) => f.properties["id"])).toEqual(["in", "ng"]);
  });

  it("filterLots applies only4Plus and superficieMinM2 on enriched properties", () => {
    const lots = [
      feature({ multifamilial4plus: true, superficieM2: 1200 }),
      feature({ multifamilial4plus: false, superficieM2: 5000 }),
      feature({ multifamilial4plus: true, superficieM2: 300 }),
      feature({}), // no flags at all (zonage indisponible côté api)
    ];
    expect(filterLots(lots, { only4Plus: true })).toHaveLength(2);
    expect(filterLots(lots, { superficieMinM2: 1000 })).toHaveLength(2);
    expect(filterLots(lots, { only4Plus: true, superficieMinM2: 1000 })).toHaveLength(1);
  });
});

describe("MockRawDataSource", () => {
  const mock = new MockRawDataSource();

  it("serves a bounded zones FeatureCollection for a known city", async () => {
    const res = await mock.getZonesGeojson({ city: "longueuil", limit: 500 });
    expect(res.featureCollection.type).toBe("FeatureCollection");
    expect(res.numberReturned).toBeGreaterThan(0);
    expect(res.truncated).toBe(false);
    expect(res.collectionId).toBe("qc-zonage-longueuil");
  });

  it("reports truncation when limit < matched", async () => {
    const res = await mock.getZonesGeojson({ city: "longueuil", limit: 1 });
    expect(res.numberReturned).toBe(1);
    expect(res.numberMatched).toBeGreaterThan(1);
    expect(res.truncated).toBe(true);
  });

  it("lots carry the enrichment contract fields and honour only4Plus", async () => {
    const all = await mock.getLotsGeojson({ city: "longueuil", limit: 500 });
    expect(all.numberReturned).toBe(3);
    const first = all.featureCollection.features[0]!.properties;
    expect(first).toHaveProperty("multifamilial4plus");
    expect(first).toHaveProperty("multifamilial4plusSource");
    expect(first).toHaveProperty("superficieM2");
    expect(first).toHaveProperty("zone");

    const only4 = await mock.getLotsGeojson({ city: "longueuil", limit: 500, only4Plus: true });
    expect(only4.numberReturned).toBe(2);
    expect(
      only4.featureCollection.features.every(
        (f) => f.properties["multifamilial4plus"] === true,
      ),
    ).toBe(true);
  });

  it("getGrillePdf finds the grille URL through the source property fallbacks", async () => {
    const hit = await mock.getGrillePdf({ city: "longueuil", zone: "h-203" });
    expect(hit.found).toBe(true);
    expect(hit.grillePdfUrl).toBe("https://longueuil.example/grilles/H-203.pdf");

    const noGrille = await mock.getGrillePdf({ city: "longueuil", zone: "C-101" });
    expect(noGrille.found).toBe(true);
    expect(noGrille.grillePdfUrl).toBeNull();

    const miss = await mock.getGrillePdf({ city: "longueuil", zone: "Z-999" });
    expect(miss.found).toBe(false);
  });

  it("getPvPdf resolves a mock document reference to a served URL + metadata", async () => {
    const hit = await mock.getPvPdf({ rawRef: "doc-longueuil-pv-2026-04-14" });
    expect(hit.found).toBe(true);
    expect(hit.url).toContain("/api/documents/raw?rawRef=");
    expect(hit.city).toBe("longueuil");
    expect(hit.publishedAt).toBe("2026-04-14");

    const miss = await mock.getPvPdf({ rawRef: "doc-inconnu" });
    expect(miss.found).toBe(false);
  });
});

describe("HttpRawDataSource", () => {
  const BASE = "http://radar-api:3000";
  const PUBLIC = "https://immo.sent-tech.ca";

  function source(fetchImpl: typeof fetch): HttpRawDataSource {
    return new HttpRawDataSource({ baseUrl: BASE, publicBaseUrl: PUBLIC, fetchImpl });
  }

  it("getZonesGeojson hits the OGC passthrough with limit + bbox and re-filters defensively", async () => {
    const inside = feature({ ZONE: "H-203" }, -73.52, 45.53);
    const outside = feature({ ZONE: "H-999" }, -73.4, 45.6);
    // Upstream IGNORES bbox (local-store path) and returns both features.
    const fetchImpl = vi.fn(async () => fcResponse([inside, outside], { numberMatched: 2 }));
    const bbox: Bbox = [-73.53, 45.52, -73.51, 45.54];
    const res = await source(fetchImpl as unknown as typeof fetch).getZonesGeojson({
      city: "Longueuil",
      bbox,
      limit: 500,
    });

    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain(`${BASE}/api/geo/collections/qc-zonage-longueuil/items`);
    expect(url).toContain("limit=500");
    expect(url).toContain(`bbox=${encodeURIComponent("-73.53,45.52,-73.51,45.54")}`);
    expect(res.numberReturned).toBe(1);
    expect(res.featureCollection.features[0]!.properties["ZONE"]).toBe("H-203");
  });

  it("getZonesGeojson reports upstream numberMatched and truncation without bbox", async () => {
    const fetchImpl = vi.fn(async () =>
      fcResponse([feature({ ZONE: "A" }), feature({ ZONE: "B" })], { numberMatched: 120 }),
    );
    const res = await source(fetchImpl as unknown as typeof fetch).getZonesGeojson({
      city: "longueuil",
      limit: 2,
    });
    expect(res.numberMatched).toBe(120);
    expect(res.numberReturned).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it("getLotsGeojson over-fetches when filters are set and filters client-side", async () => {
    const lots = [
      feature({ multifamilial4plus: true, superficieM2: 1200 }),
      feature({ multifamilial4plus: false, superficieM2: 900 }),
      feature({ multifamilial4plus: true, superficieM2: 700 }),
    ];
    const fetchImpl = vi.fn(async () => fcResponse(lots, { numberMatched: 3 }));
    const res = await source(fetchImpl as unknown as typeof fetch).getLotsGeojson({
      city: "longueuil",
      limit: 100,
      only4Plus: true,
    });

    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("qc-lots-longueuil");
    expect(url).toContain("limit=400"); // over-fetch x4 for client-side filters
    expect(res.numberReturned).toBe(2);
    expect(res.numberMatched).toBe(2); // honest: describes OUR filtered set
    expect(res.note).toContain("filtres appliqués");
  });

  it("getLotsGeojson maps a 404 collection to an explicit error", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(
      source(fetchImpl as unknown as typeof fetch).getLotsGeojson({
        city: "nulle-part",
        limit: 10,
      }),
    ).rejects.toThrow(/collection_not_found:qc-lots-nulle-part/);
  });

  it("getGrillePdf matches REAL live spellings (Zonage/URL_Grille, code suffixé)", async () => {
    // Property shape measured on qc-zonage-longueuil live (2026-07): mixed-case
    // keys + "(VLO)" suffix on the code — the readers must stay case-insensitive
    // and normalise the suffix away.
    const zones = [
      feature({
        Zonage: "H34-327 (VLO)",
        URL_Grille: "https://gociteweb.longueuil.quebec/hotlink/Logo/Zonage/VLO/H34-327.pdf",
        zone_code: "H34-327 (VLO)",
      }),
    ];
    const fetchImpl = vi.fn(async () => fcResponse(zones));
    const hit = await source(fetchImpl as unknown as typeof fetch).getGrillePdf({
      city: "longueuil",
      zone: "H34-327",
    });
    expect(hit.found).toBe(true);
    expect(hit.grillePdfUrl).toBe(
      "https://gociteweb.longueuil.quebec/hotlink/Logo/Zonage/VLO/H34-327.pdf",
    );
  });

  it("getGrillePdf looks the zone up in the zonage collection (normalised code)", async () => {
    const zones = [
      feature({ ZONE: "H-203", URL_GRILLE: "https://longueuil.example/grilles/H-203.pdf" }),
      feature({ ZONE: "C-101" }),
    ];
    const fetchImpl = vi.fn(async () => fcResponse(zones));
    const src = source(fetchImpl as unknown as typeof fetch);

    const hit = await src.getGrillePdf({ city: "longueuil", zone: "h – 203" });
    expect(hit.found).toBe(true);
    expect(hit.grillePdfUrl).toBe("https://longueuil.example/grilles/H-203.pdf");

    const noUrl = await src.getGrillePdf({ city: "longueuil", zone: "C-101" });
    expect(noUrl.found).toBe(true);
    expect(noUrl.grillePdfUrl).toBeNull();

    const miss = await src.getGrillePdf({ city: "longueuil", zone: "Z-1" });
    expect(miss.found).toBe(false);
  });

  it("getPvPdf checks existence against the api and returns the PUBLIC served URL", async () => {
    const rawRef = "raw/proces-verbaux-longueuil/cas/abc123.pdf";
    const fetchImpl = vi.fn(
      async () =>
        new Response("%PDF-1.4", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    );
    const res = await source(fetchImpl as unknown as typeof fetch).getPvPdf({ rawRef });

    const calledUrl = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toBe(`${BASE}/api/documents/raw?rawRef=${encodeURIComponent(rawRef)}`);
    expect(res.found).toBe(true);
    expect(res.url).toBe(`${PUBLIC}/api/documents/raw?rawRef=${encodeURIComponent(rawRef)}`);
    expect(res.contentType).toBe("application/pdf");
    expect(res.city).toBe("longueuil");
  });

  it("getPvPdf maps 404/400 to found=false (no throw)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 }));
    const res = await source(fetchImpl as unknown as typeof fetch).getPvPdf({
      rawRef: "raw/proces-verbaux-x/cas/nope.pdf",
    });
    expect(res.found).toBe(false);
  });
});

describe("createRawDataSource", () => {
  it("defaults to mock without RADAR_API_BASE_URL and to http with it", () => {
    expect(createRawDataSource({}).mode).toBe("mock");
    expect(
      createRawDataSource({ RADAR_API_BASE_URL: "http://radar-api:3000" }).mode,
    ).toBe("http");
  });
});
