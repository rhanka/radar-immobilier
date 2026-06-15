/**
 * Tests du CkanZonageAdapter (P1-A — CKAN Données Québec zonage).
 *
 * Tous les tests utilisent des fixtures statiques — AUCUN appel réseau en CI.
 * Les fixtures sont capturées depuis l'API CKAN DQ live (2026-06-14).
 */

import { describe, it, expect, vi } from "vitest";
import type { FetchLike } from "./geo-fetch-utils.js";
import {
  CkanZonageAdapter,
  detectCkanZoneCodeField,
  normalizeCkanZoneFeature,
  filterCkanGeoResources,
  ckanPackageSearch,
  ckanPackageShow,
  CKAN_ZONAGE_ADAPTER_VERSION,
  CKAN_ZONAGE_REGISTRY,
  getCkanZonageEntry,
  listCkanCities,
} from "./ckan-zonage.js";
import {
  LONGUEUIL_CKAN_PACKAGE_ID,
  LONGUEUIL_CKAN_GEOJSON_URL,
  LONGUEUIL_CKAN_PACKAGE_FIXTURE,
  LONGUEUIL_CKAN_GEOJSON_FIXTURE,
  SAGUENAY_CKAN_PACKAGE_ID,
  SAGUENAY_CKAN_GEOJSON_URL,
  SAGUENAY_CKAN_GEOJSON_FIXTURE,
  CKAN_SEARCH_ZONAGE_FIXTURE,
  SHERBROOKE_CKAN_PACKAGE_FIXTURE,
} from "./ckan-zonage.fixture.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Mock FetchLike qui mappe chaque URL à une réponse par fragment d'URL.
 */
function makeUrlMockFetch(urlMap: Record<string, unknown>): FetchLike {
  return vi.fn((url: string, _init?: unknown) => {
    for (const [fragment, response] of Object.entries(urlMap)) {
      if (url.includes(fragment)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: (_name: string) => "application/json" },
          text: () => Promise.resolve(JSON.stringify(response)),
          arrayBuffer: () =>
            Promise.resolve(
              new TextEncoder().encode(JSON.stringify(response)).buffer,
            ),
        });
      }
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      headers: { get: (_name: string) => null },
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
  }) as unknown as FetchLike;
}

// ─── Tests detectCkanZoneCodeField ────────────────────────────────────────

describe("detectCkanZoneCodeField", () => {
  it("détecte no_zone (Saguenay)", () => {
    const props = { id: 2472, municipalite: "94068", no_zone: "1000" };
    expect(detectCkanZoneCodeField(props)).toBe("no_zone");
  });

  it("détecte Zonage (Longueuil)", () => {
    const props = { Zonage: "P22-328 (VLO)", URL_Grille: "..." };
    expect(detectCkanZoneCodeField(props)).toBe("Zonage");
  });

  it("détecte NO_ZONE en priorité sur no_zone", () => {
    const props = { NO_ZONE: "A1336", no_zone: "1000", OBJECTID: 1 };
    expect(detectCkanZoneCodeField(props)).toBe("NO_ZONE");
  });

  it("fallback : premier champ String non-OID", () => {
    const props = { id: 1, type_zone: "residential", area: 500 };
    expect(detectCkanZoneCodeField(props)).toBe("type_zone");
  });

  it("retourne null si aucun candidat et pas de champ String valide", () => {
    const props = { id: 1, area: 500 };
    expect(detectCkanZoneCodeField(props)).toBeNull();
  });
});

// ─── Tests normalizeCkanZoneFeature ───────────────────────────────────────

describe("normalizeCkanZoneFeature", () => {
  it("normalise un feature Longueuil (champ Zonage)", () => {
    const feature = LONGUEUIL_CKAN_GEOJSON_FIXTURE.features[0];
    const zone = normalizeCkanZoneFeature(feature, "Zonage", 0);
    expect(zone).not.toBeNull();
    expect(zone?.zoneCode).toBe("P22-328 (VLO)");
    expect(zone?.zoneCodeField).toBe("Zonage");
    expect(zone?.index).toBe(0);
    expect(zone?.geometry.type).toBe("Polygon");
    expect(zone?.properties["URL_Grille"]).toContain("P22-328.pdf");
  });

  it("normalise un feature Saguenay (champ no_zone)", () => {
    const feature = SAGUENAY_CKAN_GEOJSON_FIXTURE.features[0];
    const zone = normalizeCkanZoneFeature(feature, "no_zone", 0);
    expect(zone).not.toBeNull();
    expect(zone?.zoneCode).toBe("1000");
    expect(zone?.zoneCodeField).toBe("no_zone");
    expect(zone?.properties["municipalite"]).toBe("94068");
  });

  it("retourne null si le champ zone est absent", () => {
    const feature = {
      type: "Feature",
      properties: { municipalite: "94068" },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    };
    expect(normalizeCkanZoneFeature(feature, "no_zone", 0)).toBeNull();
  });

  it("retourne null si la géométrie est absente", () => {
    const feature = {
      type: "Feature",
      properties: { no_zone: "1000" },
      geometry: null,
    };
    expect(normalizeCkanZoneFeature(feature, "no_zone", 0)).toBeNull();
  });

  it("retourne null pour un type non-Feature", () => {
    const notAFeature = { type: "FeatureCollection" };
    expect(normalizeCkanZoneFeature(notAFeature, "no_zone", 0)).toBeNull();
  });

  it("normalise un code zone avec espaces (trim)", () => {
    const feature = {
      type: "Feature",
      properties: { no_zone: "  RA-100  " },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    };
    const zone = normalizeCkanZoneFeature(feature, "no_zone", 0);
    expect(zone?.zoneCode).toBe("RA-100");
  });
});

// ─── Tests filterCkanGeoResources ─────────────────────────────────────────

describe("filterCkanGeoResources", () => {
  it("retourne la ressource GeoJSON de Longueuil", () => {
    // Construire un CkanPackage directement depuis la fixture (types alignés)
    const parsed = {
      id: LONGUEUIL_CKAN_PACKAGE_FIXTURE.result.id,
      name: LONGUEUIL_CKAN_PACKAGE_FIXTURE.result.name,
      title: LONGUEUIL_CKAN_PACKAGE_FIXTURE.result.title,
      organization: LONGUEUIL_CKAN_PACKAGE_FIXTURE.result.organization.name,
      license: LONGUEUIL_CKAN_PACKAGE_FIXTURE.result.license_id,
      resources: LONGUEUIL_CKAN_PACKAGE_FIXTURE.result.resources.map((r) => ({
        id: r.id,
        name: r.name,
        format: r.format,
        url: r.url,
      })),
    };
    const geoResources = filterCkanGeoResources(parsed);
    expect(geoResources.length).toBeGreaterThanOrEqual(1);
    expect(geoResources[0]?.format).toBe("geojson");
    expect(geoResources[0]?.downloadUrl).toContain("zonage.json");
  });

  it("Sherbrooke : retourne d'abord le GeoJSON, puis l'EsriREST", () => {
    const pkg = SHERBROOKE_CKAN_PACKAGE_FIXTURE.result;
    const parsed = {
      id: pkg.id,
      name: pkg.name,
      title: pkg.title,
      organization: pkg.organization.name,
      license: pkg.license_id,
      resources: pkg.resources.map((r) => ({
        id: r.id,
        name: r.name,
        format: r.format,
        url: r.url,
      })),
    };
    const geoResources = filterCkanGeoResources(parsed);
    expect(geoResources).toHaveLength(2);
    expect(geoResources[0]?.format).toBe("geojson");
    expect(geoResources[1]?.format).toBe("esrirest");
  });

  it("retourne un tableau vide si aucune ressource géo", () => {
    const pkg = {
      id: "test",
      name: "test",
      title: "Test",
      organization: "test-org",
      license: "cc-by",
      resources: [
        { id: "r1", name: "CSV", format: "CSV", url: "https://example.com/data.csv" },
        { id: "r2", name: "PDF", format: "PDF", url: "https://example.com/plan.pdf" },
      ],
    };
    expect(filterCkanGeoResources(pkg)).toHaveLength(0);
  });
});

// ─── Tests ckanPackageSearch ───────────────────────────────────────────────

describe("ckanPackageSearch", () => {
  it("retourne count=50 et 2 packages depuis le fixture", async () => {
    const mockFetch = makeUrlMockFetch({
      package_search: CKAN_SEARCH_ZONAGE_FIXTURE,
    });

    const result = await ckanPackageSearch("zonage", {
      baseUrl: "https://www.donneesquebec.ca/recherche/api/3/action",
      fetchImpl: mockFetch,
    });

    expect(result.count).toBe(50);
    expect(result.packages).toHaveLength(2);
    expect(result.packages[0]?.organization).toBe("ville-de-longueuil");
    expect(result.packages[1]?.organization).toBe("ville-de-saguenay");
  });

  it("lève SourceFetchError sur HTTP 404", async () => {
    const mockFetch = makeUrlMockFetch({});
    await expect(
      ckanPackageSearch("zonage", {
        baseUrl: "https://www.donneesquebec.ca/recherche/api/3/action",
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow("HTTP 404");
  });
});

// ─── Tests ckanPackageShow ─────────────────────────────────────────────────

describe("ckanPackageShow", () => {
  it("retourne le package Longueuil avec ses ressources", async () => {
    const mockFetch = makeUrlMockFetch({
      package_show: LONGUEUIL_CKAN_PACKAGE_FIXTURE,
    });

    const pkg = await ckanPackageShow(LONGUEUIL_CKAN_PACKAGE_ID, {
      baseUrl: "https://www.donneesquebec.ca/recherche/api/3/action",
      fetchImpl: mockFetch,
    });

    expect(pkg.id).toBe(LONGUEUIL_CKAN_PACKAGE_ID);
    expect(pkg.organization).toBe("ville-de-longueuil");
    expect(pkg.license).toBe("cc-by");
    expect(pkg.resources).toHaveLength(2);
    expect(pkg.resources[0]?.format).toBe("GeoJSON");
    expect(pkg.resources[0]?.url).toContain("zonage.json");
  });
});

// ─── Tests CkanZonageAdapter — Longueuil ─────────────────────────────────

describe("CkanZonageAdapter — Longueuil", () => {
  it("expose kind, city, version", () => {
    const adapter = new CkanZonageAdapter({
      city: "longueuil",
      resourceUrl: LONGUEUIL_CKAN_GEOJSON_URL,
      packageId: LONGUEUIL_CKAN_PACKAGE_ID,
      organization: "ville-de-longueuil",
    });
    expect(adapter.kind).toBe("ckan-zonage");
    expect(adapter.city).toBe("longueuil");
    expect(adapter.version).toBe(CKAN_ZONAGE_ADAPTER_VERSION);
  });

  it("list() yield un RawDocumentRef avec city et sourceKind", async () => {
    const adapter = new CkanZonageAdapter({
      city: "longueuil",
      resourceUrl: LONGUEUIL_CKAN_GEOJSON_URL,
      packageId: LONGUEUIL_CKAN_PACKAGE_ID,
    });

    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs).toHaveLength(1);
    const ref = refs[0] as Record<string, unknown>;
    expect(ref["city"]).toBe("longueuil");
    expect(ref["sourceKind"]).toBe("ckan-zonage");
    expect(String(ref["url"])).toContain("zonage.json");
  });

  it("fetchAllZones() retourne 3 zones Longueuil", async () => {
    const mockFetch = makeUrlMockFetch({
      "fafe8962": LONGUEUIL_CKAN_GEOJSON_FIXTURE,
    });

    const adapter = new CkanZonageAdapter({
      city: "longueuil",
      resourceUrl: LONGUEUIL_CKAN_GEOJSON_URL,
      zoneCodeField: "Zonage",
      fetchImpl: mockFetch,
    });

    const zones = await adapter.fetchAllZones();
    expect(zones).toHaveLength(3);
    expect(zones[0]?.zoneCode).toBe("P22-328 (VLO)");
    expect(zones[0]?.zoneCodeField).toBe("Zonage");
    expect(zones[0]?.properties["URL_Grille"]).toContain("P22-328.pdf");
  });

  it("fetchAllZones() détecte automatiquement le champ Zonage", async () => {
    const mockFetch = makeUrlMockFetch({
      "fafe8962": LONGUEUIL_CKAN_GEOJSON_FIXTURE,
    });

    const adapter = new CkanZonageAdapter({
      city: "longueuil",
      resourceUrl: LONGUEUIL_CKAN_GEOJSON_URL,
      // Pas de zoneCodeField — détection automatique
      fetchImpl: mockFetch,
    });

    const zones = await adapter.fetchAllZones();
    expect(zones).toHaveLength(3);
    expect(zones[0]?.zoneCodeField).toBe("Zonage");
  });

  it("fetch() retourne un RawDocument GeoJSON normalisé", async () => {
    const mockFetch = makeUrlMockFetch({
      "fafe8962": LONGUEUIL_CKAN_GEOJSON_FIXTURE,
    });

    const adapter = new CkanZonageAdapter({
      city: "longueuil",
      resourceUrl: LONGUEUIL_CKAN_GEOJSON_URL,
      zoneCodeField: "Zonage",
      packageId: LONGUEUIL_CKAN_PACKAGE_ID,
      organization: "ville-de-longueuil",
      fetchImpl: mockFetch,
      now: () => new Date("2026-06-14T12:00:00Z"),
    });

    const ref = {
      sourceKind: "ckan-zonage" as const,
      city: "longueuil",
      url: LONGUEUIL_CKAN_GEOJSON_URL,
      discoveredAt: "2026-06-14T12:00:00Z",
    };

    const doc = await adapter.fetch(ref);
    expect(doc.sourceKind).toBe("ckan-zonage");
    expect(doc.city).toBe("longueuil");
    expect(doc.contentType).toBe("application/geo+json");
    expect(doc.provenance.obtentionMode).toBe("download");
    expect(doc.metadata?.["zoneCount"]).toBe(3);

    const fc = JSON.parse(new TextDecoder().decode(doc.body)) as {
      type: string;
      features: unknown[];
    };
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(3);
    const firstProps = (fc.features[0] as Record<string, unknown>)[
      "properties"
    ] as Record<string, unknown>;
    expect(firstProps["zone_code"]).toBe("P22-328 (VLO)");
    expect(firstProps["zone_code_field"]).toBe("Zonage");
  });
});

// ─── Tests CkanZonageAdapter — Saguenay ──────────────────────────────────

describe("CkanZonageAdapter — Saguenay", () => {
  it("détecte automatiquement no_zone et yield 3 zones", async () => {
    const mockFetch = makeUrlMockFetch({
      "6d5e4aa8": SAGUENAY_CKAN_GEOJSON_FIXTURE,
    });

    const adapter = new CkanZonageAdapter({
      city: "saguenay",
      resourceUrl: SAGUENAY_CKAN_GEOJSON_URL,
      packageId: SAGUENAY_CKAN_PACKAGE_ID,
      fetchImpl: mockFetch,
    });

    const zones = await adapter.fetchAllZones();
    expect(zones).toHaveLength(3);
    expect(zones[0]?.zoneCode).toBe("1000");
    expect(zones[0]?.zoneCodeField).toBe("no_zone");
    expect(zones[1]?.zoneCode).toBe("2000");
    expect(zones[2]?.zoneCode).toBe("3100");
  });

  it("hash() retourne un sha256 déterministe", async () => {
    const mockFetch = makeUrlMockFetch({
      "6d5e4aa8": SAGUENAY_CKAN_GEOJSON_FIXTURE,
    });

    const adapter = new CkanZonageAdapter({
      city: "saguenay",
      resourceUrl: SAGUENAY_CKAN_GEOJSON_URL,
      fetchImpl: mockFetch,
      now: () => new Date("2026-06-14T12:00:00Z"),
    });

    const ref = {
      sourceKind: "ckan-zonage" as const,
      city: "saguenay",
      url: SAGUENAY_CKAN_GEOJSON_URL,
      discoveredAt: "2026-06-14T12:00:00Z",
    };

    const doc = await adapter.fetch(ref);
    expect(adapter.hash(doc)).toHaveLength(64); // sha256 hex
    expect(adapter.hash(doc)).toBe(adapter.hash(doc)); // idempotent
  });
});

// ─── Tests du registre CKAN ───────────────────────────────────────────────

describe("CKAN_ZONAGE_REGISTRY", () => {
  it("contient au moins 8 villes", () => {
    expect(CKAN_ZONAGE_REGISTRY.length).toBeGreaterThanOrEqual(8);
  });

  it("Longueuil a un packageId et un geojsonUrl valides", () => {
    const entry = getCkanZonageEntry("longueuil");
    expect(entry).not.toBeUndefined();
    expect(entry?.packageId).toBe("aedd53ac-131d-4141-93c4-8d4211eb2d95");
    expect(entry?.geojsonUrl).toContain("zonage.json");
    expect(entry?.zoneCodeField).toBe("Zonage");
    expect(entry?.featureCount).toBe(2085);
  });

  it("Saguenay a un champ no_zone et 2838 features", () => {
    const entry = getCkanZonageEntry("saguenay");
    expect(entry?.zoneCodeField).toBe("no_zone");
    expect(entry?.featureCount).toBe(2838);
  });

  it("listCkanCities() retourne les slugs de toutes les villes du registre", () => {
    const cities = listCkanCities();
    expect(cities).toContain("longueuil");
    expect(cities).toContain("saguenay");
    expect(cities).toContain("levis");
    expect(cities).toContain("trois-rivieres");
    expect(cities).toContain("quebec");
  });

  it("getCkanZonageEntry() retourne undefined pour une ville inconnue", () => {
    expect(getCkanZonageEntry("ville-inconnue")).toBeUndefined();
  });

  it("toutes les entrées ont un citySlug, packageId, geojsonUrl et verifiedAt", () => {
    for (const entry of CKAN_ZONAGE_REGISTRY) {
      expect(entry.citySlug.length).toBeGreaterThan(0);
      expect(entry.packageId.length).toBeGreaterThan(0);
      expect(entry.geojsonUrl).toContain("http");
      expect(entry.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
