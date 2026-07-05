/**
 * Tests du chemin zones TIERÉ de la vue Signaux (signaux-zones-loader).
 *
 * Bug reproduit (Salaberry-de-Valleyfield) : l'endpoint de résolution
 * `/api/geo/:slug/zones` ne connaît pas la ville (0 zone) ALORS QUE la
 * collection OGC `qc-zonage-<slug>` sert 645 vraies zones via le passthrough.
 * La vue basculait à tort en fallback « contour ville ».
 *
 * Clients INJECTÉS (aucun fetch réseau) — le mock collection reproduit la
 * volumétrie réelle (645 zones, codes préfixés, kind absent).
 */
import { describe, it, expect, vi } from "vitest";
import {
  ZONES_COLLECTION_LIMIT,
  emptyUnconfiguredZones,
  geoZonesResponseFromCollection,
  loadSignauxZones,
} from "./signaux-zones-loader.js";
import type { GeoZonesResponse } from "./geo-zones-client.js";
import type { ZonesResponse, ZoneFeature } from "./zones-client.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CITY = "salaberry-de-valleyfield";

function zoneFeature(code: string, withGeometry = true): ZoneFeature {
  return {
    type: "Feature",
    geometry: withGeometry
      ? { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }
      : null,
    properties: { code, citySlug: CITY },
  };
}

/** Collection OGC mock à l'échelle réelle : 645 zones (A-1 … A-645). */
function collectionOf(count: number): ZonesResponse {
  return {
    ok: true,
    citySlug: CITY,
    source: "donnees-quebec",
    collectionId: `qc-zonage-${CITY}`,
    numberMatched: count,
    numberReturned: count,
    featureCollection: {
      type: "FeatureCollection",
      features: Array.from({ length: count }, (_, i) => zoneFeature(`A-${i + 1}`)),
    },
  };
}

function missingCollection(): ZonesResponse {
  return {
    ok: false,
    citySlug: CITY,
    source: "none",
    reason: `Collection zonage non configurée dans l'API geo : qc-zonage-${CITY}`,
    collectionId: `qc-zonage-${CITY}`,
    numberMatched: 0,
    numberReturned: 0,
    featureCollection: { type: "FeatureCollection", features: [] },
  };
}

function endpointWithZones(): GeoZonesResponse {
  return {
    ok: true,
    citySlug: CITY,
    source: "official",
    resolutionStatus: "official",
    geometryStatus: "official",
    zoneCount: 2,
    warnings: [],
    featureCollection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
          properties: {
            code: "H-1",
            citySlug: CITY,
            geometryStatus: "official",
            confidence: 1,
            source: "official-zone",
            lotCount: 3,
            lots: [],
          },
        },
        {
          type: "Feature",
          geometry: null,
          properties: {
            code: "H-2",
            citySlug: CITY,
            geometryStatus: "missing",
            confidence: 0,
            source: "official-zone",
            lotCount: 0,
            lots: [],
          },
        },
      ],
    },
  };
}

function endpointEmpty(): GeoZonesResponse {
  return {
    ok: true,
    citySlug: CITY,
    source: "none",
    resolutionStatus: "missing",
    geometryStatus: "missing",
    zoneCount: 0,
    warnings: [],
    featureCollection: { type: "FeatureCollection", features: [] },
  };
}

// ── Adaptateur collection → GeoZonesResponse ─────────────────────────────────

describe("geoZonesResponseFromCollection", () => {
  it("adapte 645 zones OGC en zones officielles rendables (aplats + codes)", () => {
    const adapted = geoZonesResponseFromCollection(collectionOf(645));
    expect(adapted.ok).toBe(true);
    expect(adapted.zoneCount).toBe(645);
    expect(adapted.resolutionStatus).toBe("official");
    expect(adapted.geometryStatus).toBe("official");
    expect(adapted.featureCollection.features).toHaveLength(645);
    const first = adapted.featureCollection.features[0];
    expect(first.properties.code).toBe("A-1");
    expect(first.properties.citySlug).toBe(CITY);
    expect(first.properties.source).toBe("official-zone");
    expect(first.properties.geometryStatus).toBe("official");
    expect(first.properties.confidence).toBe(1);
    expect(first.geometry).not.toBeNull();
  });

  it("zone sans géométrie → geometryStatus missing, confiance 0 (aucune invention)", () => {
    const collection = collectionOf(1);
    collection.featureCollection.features = [zoneFeature("H-9", false)];
    const adapted = geoZonesResponseFromCollection(collection);
    expect(adapted.featureCollection.features[0].properties.geometryStatus).toBe("missing");
    expect(adapted.featureCollection.features[0].properties.confidence).toBe(0);
    expect(adapted.geometryStatus).toBe("missing");
  });

  it("transmet kind et grillePdfUrl quand la collection les expose", () => {
    const collection = collectionOf(1);
    collection.featureCollection.features = [
      {
        ...zoneFeature("C-18"),
        properties: {
          code: "C-18",
          citySlug: CITY,
          kind: "commerce",
          grillePdfUrl: "https://example.org/grille-c18.pdf",
        },
      },
    ];
    const adapted = geoZonesResponseFromCollection(collection);
    const props = adapted.featureCollection.features[0].properties;
    expect(props.kind).toBe("commerce");
    expect(props.grillePdfUrl).toBe("https://example.org/grille-c18.pdf");
    expect(props.label).toContain("C-18");
  });

  it("transmet l'affectation (mont-tremblant) — le label lisible la préfère au code kind", () => {
    const collection = collectionOf(1);
    collection.featureCollection.features = [
      {
        ...zoneFeature("CO-939"),
        properties: {
          code: "CO-939",
          citySlug: CITY,
          kind: "CO",
          affectation: "Conservation",
        },
      },
    ];
    const adapted = geoZonesResponseFromCollection(collection);
    const props = adapted.featureCollection.features[0].properties;
    expect(props.kind).toBe("CO");
    expect(props.affectation).toBe("Conservation");
    expect(props.label).toBe("CO-939 — Conservation");
  });
});

// ── Résolution tiérée ─────────────────────────────────────────────────────────

describe("loadSignauxZones — endpoint → collection → contour", () => {
  it("endpoint avec zones → tier endpoint, la collection n'est PAS appelée", async () => {
    const fetchCollection = vi.fn();
    const load = await loadSignauxZones(CITY, {
      fetchResolvedZones: vi.fn().mockResolvedValue(endpointWithZones()),
      fetchZonesCollection: fetchCollection,
    });
    expect(load.tier).toBe("endpoint");
    expect(load.response?.zoneCount).toBe(2);
    expect(fetchCollection).not.toHaveBeenCalled();
  });

  it("endpoint vide (200, 0 zone) + collection 645 → VRAIES zones (tier collection), plus de contour", async () => {
    const load = await loadSignauxZones(CITY, {
      fetchResolvedZones: vi.fn().mockResolvedValue(endpointEmpty()),
      fetchZonesCollection: vi.fn().mockResolvedValue(collectionOf(645)),
    });
    expect(load.tier).toBe("collection");
    expect(load.response?.zoneCount).toBe(645);
    expect(load.response?.featureCollection.features).toHaveLength(645);
  });

  it("endpoint 404 + collection 645 → tier collection (le 404 n'est pas une erreur)", async () => {
    const load = await loadSignauxZones(CITY, {
      fetchResolvedZones: vi
        .fn()
        .mockRejectedValue(new Error(`geo-zones HTTP 404 for ${CITY}`)),
      fetchZonesCollection: vi.fn().mockResolvedValue(collectionOf(645)),
    });
    expect(load.tier).toBe("collection");
    expect(load.response?.zoneCount).toBe(645);
  });

  it("endpoint vide + collection absente → tier none avec la réponse endpoint (contour à l'appelant)", async () => {
    const load = await loadSignauxZones(CITY, {
      fetchResolvedZones: vi.fn().mockResolvedValue(endpointEmpty()),
      fetchZonesCollection: vi.fn().mockResolvedValue(missingCollection()),
    });
    expect(load.tier).toBe("none");
    expect(load.response).not.toBeNull();
    expect(load.response?.zoneCount).toBe(0);
  });

  it("endpoint 404 + collection absente → tier none, response null (état vide honnête)", async () => {
    const load = await loadSignauxZones(CITY, {
      fetchResolvedZones: vi
        .fn()
        .mockRejectedValue(new Error(`geo-zones HTTP 404 for ${CITY}`)),
      fetchZonesCollection: vi.fn().mockResolvedValue(missingCollection()),
    });
    expect(load.tier).toBe("none");
    expect(load.response).toBeNull();
  });

  it("propage la limite (couvre 645/2085 zones) et le signal d'annulation à la collection", async () => {
    const fetchCollection = vi.fn().mockResolvedValue(collectionOf(645));
    const controller = new AbortController();
    await loadSignauxZones(CITY, {
      fetchResolvedZones: vi.fn().mockResolvedValue(endpointEmpty()),
      fetchZonesCollection: fetchCollection,
      signal: controller.signal,
    });
    expect(fetchCollection).toHaveBeenCalledWith(CITY, {
      limit: ZONES_COLLECTION_LIMIT,
      signal: controller.signal,
    });
    expect(ZONES_COLLECTION_LIMIT).toBeGreaterThanOrEqual(2085);
  });

  it("erreur endpoint NON-404 (réseau/timeout) → remonte telle quelle", async () => {
    await expect(
      loadSignauxZones(CITY, {
        fetchResolvedZones: vi.fn().mockRejectedValue(new Error("geo-zones HTTP 502 for x")),
        fetchZonesCollection: vi.fn(),
      }),
    ).rejects.toThrow("HTTP 502");
  });

  it("erreur collection (réseau) → remonte telle quelle (état d'erreur honnête, pas un faux contour)", async () => {
    await expect(
      loadSignauxZones(CITY, {
        fetchResolvedZones: vi.fn().mockResolvedValue(endpointEmpty()),
        fetchZonesCollection: vi.fn().mockRejectedValue(new Error("network down")),
      }),
    ).rejects.toThrow("network down");
  });
});

describe("emptyUnconfiguredZones", () => {
  it("porte le warning geo-collection-not-configured (badge « zones non configurées »)", () => {
    const empty = emptyUnconfiguredZones(CITY);
    expect(empty.ok).toBe(false);
    expect(empty.warnings).toContain("geo-collection-not-configured");
    expect(empty.featureCollection.features).toHaveLength(0);
  });
});
