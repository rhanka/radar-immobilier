/**
 * Tests unitaires — Routes geo-features (G3 WP géo-intégration).
 *
 * GET /api/geo/cities   → liste des villes avec données géo
 * GET /api/geo/features/:citySlug → FeatureCollection fusionnée
 *
 * Les services sont mockés : aucun Postgres requis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { geoFeaturesRoute } from "./geo-features.js";
import type { Database } from "../db/client.js";
import type { GeoFeaturesResult, GeoFeatureCollection } from "../services/geo/geo-features.js";

vi.mock("../services/geo/geo-features.js", () => ({
  getGeoFeatures: vi.fn(),
  listGeoCities: vi.fn(),
}));

import { getGeoFeatures, listGeoCities } from "../services/geo/geo-features.js";

const mockDb = {} as unknown as Database;

const emptyFc: GeoFeatureCollection = { type: "FeatureCollection", features: [] };

function makeGeoResult(citySlug: string): GeoFeaturesResult {
  return {
    citySlug,
    zoneCount: 2,
    lotCount: 3,
    opportuniteCount: 1,
    zones: {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "MultiPolygon", coordinates: [] as unknown },
          properties: {
            featureKind: "zone",
            zoneVersionId: "uuid-1",
            canonicalId: "zone-can-1",
            zoneCode: "H34-327",
            zoneUsage: "Habitation",
            citySlug,
            signalCount: 1,
            category: "rezonage",
            anticipation: null,
            geomSource: "arcgis",
            geomFetchedAt: null,
          },
        },
        {
          type: "Feature" as const,
          geometry: { type: "MultiPolygon", coordinates: [] as unknown },
          properties: {
            featureKind: "zone",
            zoneVersionId: "uuid-2",
            canonicalId: "zone-can-2",
            zoneCode: "C-512",
            zoneUsage: "Commercial",
            citySlug,
            signalCount: 0,
            category: null,
            anticipation: null,
            geomSource: "arcgis",
            geomFetchedAt: null,
          },
        },
      ],
    },
    lots: {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "MultiPolygon", coordinates: [] as unknown },
          properties: {
            featureKind: "lot",
            lotVersionId: "uuid-l1",
            canonicalId: "lot-can-1",
            noLot: "6057912",
            citySlug,
            superficieM2: null,
            usage: null,
            zoneCode: null,
            signalCount: 0,
            category: null,
            geomSource: "cadastre-allege",
            geomFetchedAt: null,
          },
        },
      ],
    },
    opportunites: {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: null,
          properties: {
            featureKind: "opportunite",
            signalId: "sig-1",
            type: "Signal",
            label: "Rezonage zone H34-327",
            citySlug,
            category: "rezonage",
            etape: "avis_motion",
            date: "2026-01-15",
            sourceRef: null,
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/geo/cities", () => {
  it("retourne ok:true avec liste vide quand aucune ville", async () => {
    vi.mocked(listGeoCities).mockResolvedValueOnce([]);
    const app = geoFeaturesRoute({ db: mockDb });
    const res = await app.request("/api/geo/cities");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.cities).toEqual([]);
  });

  it("retourne la liste des villes avec compteurs", async () => {
    vi.mocked(listGeoCities).mockResolvedValueOnce([
      { citySlug: "longueuil", zoneCount: 50, lotCount: 120, signalCount: 5 },
      { citySlug: "sherbrooke", zoneCount: 30, lotCount: 0, signalCount: 2 },
    ]);
    const app = geoFeaturesRoute({ db: mockDb });
    const res = await app.request("/api/geo/cities");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.cities).toHaveLength(2);
    expect(body.cities[0].citySlug).toBe("longueuil");
    expect(body.cities[0].zoneCount).toBe(50);
  });

  it("retourne 500 en cas d'erreur DB", async () => {
    vi.mocked(listGeoCities).mockRejectedValueOnce(new Error("db_error"));
    const app = geoFeaturesRoute({ db: mockDb });
    const res = await app.request("/api/geo/cities");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("geo_cities_error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/geo/features/:citySlug", () => {
  it("retourne la FeatureCollection fusionnée pour une ville", async () => {
    const citySlug = "longueuil";
    vi.mocked(getGeoFeatures).mockResolvedValueOnce(makeGeoResult(citySlug));
    const app = geoFeaturesRoute({ db: mockDb });
    const res = await app.request(`/api/geo/features/${citySlug}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe(citySlug);
    expect(body.zoneCount).toBe(2);
    expect(body.lotCount).toBe(3);
    expect(body.opportuniteCount).toBe(1);
    expect(body.zones.type).toBe("FeatureCollection");
    expect(body.zones.features).toHaveLength(2);
    expect(body.lots.features).toHaveLength(1);
    expect(body.opportunites.features).toHaveLength(1);
  });

  it("retourne empty-state valide (0 zones, 0 lots, 0 opps) sans erreur", async () => {
    const citySlug = "ville-sans-données";
    vi.mocked(getGeoFeatures).mockResolvedValueOnce({
      citySlug,
      zoneCount: 0,
      lotCount: 0,
      opportuniteCount: 0,
      zones: emptyFc,
      lots: emptyFc,
      opportunites: emptyFc,
    });
    const app = geoFeaturesRoute({ db: mockDb });
    const res = await app.request(`/api/geo/features/${citySlug}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.zoneCount).toBe(0);
    expect(body.zones.features).toHaveLength(0);
  });

  it("vérifie que getGeoFeatures est appelé avec le bon slug normalisé", async () => {
    vi.mocked(getGeoFeatures).mockResolvedValueOnce(makeGeoResult("longueuil"));
    const app = geoFeaturesRoute({ db: mockDb });
    await app.request("/api/geo/features/Longueuil");
    expect(vi.mocked(getGeoFeatures)).toHaveBeenCalledWith(mockDb, "longueuil");
  });

  it("retourne 500 en cas d'erreur DB", async () => {
    vi.mocked(getGeoFeatures).mockRejectedValueOnce(new Error("db_fail"));
    const app = geoFeaturesRoute({ db: mockDb });
    const res = await app.request("/api/geo/features/longueuil");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("geo_features_error");
  });
});
