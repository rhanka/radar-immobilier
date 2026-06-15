/**
 * Tests du ArcgisZonageAdapter (P0-B — crawler ArcGIS REST générique).
 *
 * Tous les tests utilisent des fixtures statiques — AUCUN appel réseau en CI.
 * Les fixtures sont capturées depuis des services publics QC live (2026-06-14).
 */

import { describe, it, expect, vi } from "vitest";
import type { FetchLike } from "./geo-fetch-utils.js";
import {
  ArcgisZonageAdapter,
  detectZoneCodeField,
  normalizeZoneFeature,
  ARCGIS_ZONAGE_ADAPTER_VERSION,
} from "./arcgis-zonage.js";
import type { ArcgisField } from "./arcgis-zonage.js";
import {
  LONGUEUIL_SERVICE_URL,
  LONGUEUIL_LAYER_INFO_FIXTURE,
  LONGUEUIL_ZONAGE_FIXTURE,
  SHAWINIGAN_SERVICE_URL,
  SHAWINIGAN_LAYER_INFO_FIXTURE,
  SHAWINIGAN_ZONAGE_FIXTURE,
  SHERBROOKE_SERVICE_URL,
  SHERBROOKE_LAYER_INFO_FIXTURE,
  SHERBROOKE_ZONAGE_FIXTURE,
} from "./arcgis-zonage.fixture.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Mock FetchLike qui mappe chaque URL à une réponse par fragment.
 * Clé = fragment d'URL (include check).
 */
function makeUrlMockFetch(urlMap: Record<string, unknown>): FetchLike {
  return vi.fn((url: string, _init?: unknown) => {
    for (const [fragment, response] of Object.entries(urlMap)) {
      if (url.includes(fragment)) {
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

// ─── Tests detectZoneCodeField ────────────────────────────────────────────

describe("detectZoneCodeField", () => {
  it("détecte NO_ZONE en priorité (Sherbrooke)", () => {
    const fields: ArcgisField[] = [
      { name: "ID", type: "esriFieldTypeSmallInteger" },
      { name: "MUNICIPALITE", type: "esriFieldTypeString" },
      { name: "NO_ZONE", type: "esriFieldTypeString" },
      { name: "GRILLEUSAGE", type: "esriFieldTypeString" },
      { name: "OBJECTID", type: "esriFieldTypeOID" },
    ];
    expect(detectZoneCodeField(fields)).toBe("NO_ZONE");
  });

  it("détecte Zonage (Longueuil)", () => {
    const fields = LONGUEUIL_LAYER_INFO_FIXTURE.fields.map((f) => ({
      name: f.name,
      type: f.type,
      ...(f.alias !== undefined ? { alias: f.alias } : {}),
    })) as ArcgisField[];
    expect(detectZoneCodeField(fields)).toBe("Zonage");
  });

  it("détecte zone_ (Shawinigan)", () => {
    const fields = SHAWINIGAN_LAYER_INFO_FIXTURE.fields.map((f) => ({
      name: f.name,
      type: f.type,
      ...(f.alias !== undefined ? { alias: f.alias } : {}),
    })) as ArcgisField[];
    expect(detectZoneCodeField(fields)).toBe("zone_");
  });

  it("retourne null si aucun candidat et pas de champ String valide", () => {
    const fields: ArcgisField[] = [
      { name: "OBJECTID", type: "esriFieldTypeOID" },
      { name: "SHAPE__Area", type: "esriFieldTypeDouble" },
    ];
    expect(detectZoneCodeField(fields)).toBeNull();
  });

  it("fallback : premier champ String non-OID/SHAPE", () => {
    const fields: ArcgisField[] = [
      { name: "OBJECTID", type: "esriFieldTypeOID" },
      { name: "DESCRIPTION", type: "esriFieldTypeString" },
    ];
    expect(detectZoneCodeField(fields)).toBe("DESCRIPTION");
  });
});

// ─── Tests normalizeZoneFeature ───────────────────────────────────────────

describe("normalizeZoneFeature", () => {
  it("normalise un feature Longueuil (champ Zonage)", () => {
    const feature = LONGUEUIL_ZONAGE_FIXTURE.features[0];
    const zone = normalizeZoneFeature(feature, "Zonage");
    expect(zone).not.toBeNull();
    expect(zone?.zoneCode).toBe("H34-327 (VLO)");
    expect(zone?.zoneCodeField).toBe("Zonage");
    expect(zone?.objectid).toBe(1);
    expect(zone?.geometry.type).toBe("Polygon");
    expect(zone?.properties["URL_Grille"]).toContain("H34-327.pdf");
  });

  it("normalise un feature Shawinigan (champ zone_, OID = objectid minuscule)", () => {
    const feature = SHAWINIGAN_ZONAGE_FIXTURE.features[0];
    const zone = normalizeZoneFeature(feature, "zone_");
    expect(zone).not.toBeNull();
    expect(zone?.zoneCode).toBe("H-9509");
    expect(zone?.objectid).toBe(1);
  });

  it("normalise un feature Sherbrooke (champ NO_ZONE)", () => {
    const feature = SHERBROOKE_ZONAGE_FIXTURE.features[0];
    const zone = normalizeZoneFeature(feature, "NO_ZONE");
    expect(zone).not.toBeNull();
    expect(zone?.zoneCode).toBe("A1336");
    expect(zone?.properties["GRILLEUSAGE"]).toContain("A1336");
  });

  it("retourne null si le champ zone est absent", () => {
    const feature = {
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    };
    expect(normalizeZoneFeature(feature, "NO_ZONE")).toBeNull();
  });

  it("retourne null si la géométrie est absente", () => {
    const feature = {
      type: "Feature",
      properties: { NO_ZONE: "A1336", OBJECTID: 1 },
      geometry: null,
    };
    expect(normalizeZoneFeature(feature, "NO_ZONE")).toBeNull();
  });

  it("retourne null pour un non-Feature", () => {
    expect(normalizeZoneFeature({ type: "Point" }, "NO_ZONE")).toBeNull();
  });
});

// ─── Tests ArcgisZonageAdapter — Longueuil ───────────────────────────────

describe("ArcgisZonageAdapter — Longueuil", () => {
  it("expose kind, city, version", () => {
    const adapter = new ArcgisZonageAdapter({
      city: "longueuil",
      serviceUrl: LONGUEUIL_SERVICE_URL,
    });
    expect(adapter.kind).toBe("arcgis-zonage");
    expect(adapter.city).toBe("longueuil");
    expect(adapter.version).toBe(ARCGIS_ZONAGE_ADAPTER_VERSION);
  });

  it("fetchLayerInfo() retourne les métadonnées de la couche", async () => {
    const mockFetch = makeUrlMockFetch({
      "?f=json": LONGUEUIL_LAYER_INFO_FIXTURE,
    });
    const adapter = new ArcgisZonageAdapter({
      city: "longueuil",
      serviceUrl: LONGUEUIL_SERVICE_URL,
      fetchImpl: mockFetch,
    });

    const info = await adapter.fetchLayerInfo();
    expect(info.name).toBe("Zonage");
    expect(info.geometryType).toBe("esriGeometryPolygon");
    expect(info.maxRecordCount).toBe(2000);
    expect(info.fields.some((f) => f.name === "Zonage")).toBe(true);
  });

  it("fetchAllZones() yield 3 zones depuis le fixture Longueuil", async () => {
    const mockFetch = makeUrlMockFetch({
      "?f=json": LONGUEUIL_LAYER_INFO_FIXTURE,
      "query?": LONGUEUIL_ZONAGE_FIXTURE,
    });

    const adapter = new ArcgisZonageAdapter({
      city: "longueuil",
      serviceUrl: LONGUEUIL_SERVICE_URL,
      fetchImpl: mockFetch,
    });

    const zones: unknown[] = [];
    for await (const zone of adapter.fetchAllZones()) {
      zones.push(zone);
    }

    expect(zones).toHaveLength(3);
    const first = zones[0] as { zoneCode: string; zoneCodeField: string };
    expect(first.zoneCode).toBe("H34-327 (VLO)");
    expect(first.zoneCodeField).toBe("Zonage");
  });
});

// ─── Tests ArcgisZonageAdapter — Shawinigan ──────────────────────────────

describe("ArcgisZonageAdapter — Shawinigan", () => {
  it("détecte automatiquement zone_ et yield 3 zones", async () => {
    const mockFetch = makeUrlMockFetch({
      "?f=json": SHAWINIGAN_LAYER_INFO_FIXTURE,
      "query?": SHAWINIGAN_ZONAGE_FIXTURE,
    });

    const adapter = new ArcgisZonageAdapter({
      city: "shawinigan",
      serviceUrl: SHAWINIGAN_SERVICE_URL,
      fetchImpl: mockFetch,
    });

    const zones: unknown[] = [];
    for await (const zone of adapter.fetchAllZones()) {
      zones.push(zone);
    }

    expect(zones).toHaveLength(3);
    const first = zones[0] as { zoneCode: string; zoneCodeField: string };
    expect(first.zoneCode).toBe("H-9509");
    expect(first.zoneCodeField).toBe("zone_");
  });
});

// ─── Tests ArcgisZonageAdapter — Sherbrooke ──────────────────────────────

describe("ArcgisZonageAdapter — Sherbrooke", () => {
  it("détecte NO_ZONE et yield 3 zones avec grille d'usage", async () => {
    const mockFetch = makeUrlMockFetch({
      "?f=json": SHERBROOKE_LAYER_INFO_FIXTURE,
      "query?": SHERBROOKE_ZONAGE_FIXTURE,
    });

    const adapter = new ArcgisZonageAdapter({
      city: "sherbrooke",
      serviceUrl: SHERBROOKE_SERVICE_URL,
      fetchImpl: mockFetch,
    });

    const zones: unknown[] = [];
    for await (const zone of adapter.fetchAllZones()) {
      zones.push(zone);
    }

    expect(zones).toHaveLength(3);
    const codes = zones.map((z) => (z as { zoneCode: string }).zoneCode);
    expect(codes).toContain("A1336");
    expect(codes).toContain("A1301");
    expect(codes).toContain("RU1302");
  });

  it("fetch() retourne un RawDocument GeoJSON valide", async () => {
    const mockFetch = makeUrlMockFetch({
      "?f=json": SHERBROOKE_LAYER_INFO_FIXTURE,
      "query?": SHERBROOKE_ZONAGE_FIXTURE,
    });

    const adapter = new ArcgisZonageAdapter({
      city: "sherbrooke",
      serviceUrl: SHERBROOKE_SERVICE_URL,
      fetchImpl: mockFetch,
      now: () => new Date("2026-06-14T12:00:00Z"),
    });

    const ref = {
      sourceKind: "arcgis-zonage" as const,
      city: "sherbrooke",
      url: `${SHERBROOKE_SERVICE_URL}/query`,
      discoveredAt: "2026-06-14T12:00:00Z",
    };

    const doc = await adapter.fetch(ref);
    expect(doc.sourceKind).toBe("arcgis-zonage");
    expect(doc.city).toBe("sherbrooke");
    expect(doc.contentType).toBe("application/geo+json");
    expect(doc.provenance.obtentionMode).toBe("api");

    const fc = JSON.parse(new TextDecoder().decode(doc.body)) as {
      type: string;
      features: unknown[];
    };
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(3);
  });
});

// ─── Tests divers ─────────────────────────────────────────────────────────

describe("ArcgisZonageAdapter — zoneCodeField override", () => {
  it("utilise le champ fourni explicitement", async () => {
    const mockFetch = makeUrlMockFetch({
      "?f=json": LONGUEUIL_LAYER_INFO_FIXTURE,
      "query?": LONGUEUIL_ZONAGE_FIXTURE,
    });

    const adapter = new ArcgisZonageAdapter({
      city: "longueuil",
      serviceUrl: LONGUEUIL_SERVICE_URL,
      zoneCodeField: "Zonage",
      fetchImpl: mockFetch,
    });

    const zones: unknown[] = [];
    for await (const zone of adapter.fetchAllZones()) {
      zones.push(zone);
    }
    expect(zones).toHaveLength(3);
  });
});

describe("ArcgisZonageAdapter — list()", () => {
  it("yields un seul RawDocumentRef avec city et sourceKind", async () => {
    const adapter = new ArcgisZonageAdapter({
      city: "longueuil",
      serviceUrl: LONGUEUIL_SERVICE_URL,
    });

    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs).toHaveLength(1);
    const ref = refs[0] as Record<string, unknown>;
    expect(ref["city"]).toBe("longueuil");
    expect(ref["sourceKind"]).toBe("arcgis-zonage");
    expect(String(ref["url"])).toContain("query");
  });
});
