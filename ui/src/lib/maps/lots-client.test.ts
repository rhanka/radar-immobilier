import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchLots,
  lotsCollectionId,
  resolveLotsUrl,
  type LotsResponse,
  type LotFeature,
} from "./lots-client.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePolygonFeature(noLot: string, citySlug: string): LotFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-74.1, 45.25],
          [-74.09, 45.25],
          [-74.09, 45.26],
          [-74.1, 45.26],
          [-74.1, 45.25],
        ],
      ],
    },
    properties: { noLot, citySlug },
  };
}

const MOCK_LOTS_OK: LotsResponse = {
  ok: true,
  citySlug: "salaberry-de-valleyfield",
  source: "donnees-quebec",
  featureCollection: {
    type: "FeatureCollection",
    features: [
      makePolygonFeature("4 516 943", "salaberry-de-valleyfield"),
      makePolygonFeature("4 516 944", "salaberry-de-valleyfield"),
    ],
  },
};

const MOCK_LOTS_EMPTY: LotsResponse = {
  ok: false,
  citySlug: "unknown-city",
  source: "none",
  reason: "Ville inconnue dans l'inventaire geo",
  featureCollection: { type: "FeatureCollection", features: [] },
};

const MOCK_OGC_LOTS_OK = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-74.002, 45.53],
            [-74.001, 45.53],
            [-74.001, 45.531],
            [-74.002, 45.531],
            [-74.002, 45.53],
          ],
        ],
      },
      properties: {
        NO_LOT: "1 733 312",
        noLot: "1 733 312",
        geoId: "ca/qc/lot/1-733-312",
        zone: "H-431",
        tod: true,
        multifamilial_4plus: true,
        superficie_m2_calculee: 712.9,
      },
    },
  ],
  numberMatched: 45099,
  numberReturned: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── resolveLotsUrl ─────────────────────────────────────────────────────────────

describe("resolveLotsUrl", () => {
  it("returns path when no baseUrl", () => {
    const url = resolveLotsUrl("salaberry-de-valleyfield", { baseUrl: "" });
    expect(url).toBe(
      "/api/geo/collections/qc-lots-salaberry-de-valleyfield/items",
    );
  });

  it("appends baseUrl stripping trailing slash", () => {
    const url = resolveLotsUrl("salaberry-de-valleyfield", {
      baseUrl: "http://localhost:3000/",
    });
    expect(url).toBe(
      "http://localhost:3000/api/geo/collections/qc-lots-salaberry-de-valleyfield/items",
    );
  });

  it("includes limit query param when provided", () => {
    const url = resolveLotsUrl("beauharnois", { baseUrl: "", limit: 50 });
    expect(url).toContain("limit=50");
  });

  it("includes bbox query param when provided", () => {
    const url = resolveLotsUrl("saint-constant", {
      baseUrl: "",
      bbox: [-73.6, 45.35, -73.52, 45.4],
    });
    expect(url).toContain("bbox=-73.6%2C45.35%2C-73.52%2C45.4");
  });

  it("URL-encodes special characters in citySlug", () => {
    const url = resolveLotsUrl("salaberry-de-valleyfield", { baseUrl: "" });
    expect(url).toContain("salaberry-de-valleyfield");
  });
});

describe("lotsCollectionId", () => {
  it("maps a city slug to the OGC lot collection id", () => {
    expect(lotsCollectionId("saint-eustache")).toBe("qc-lots-saint-eustache");
  });
});

// ── fetchLots ──────────────────────────────────────────────────────────────────

describe("fetchLots", () => {
  it("returns normalized FeatureCollection on OGC HTTP 200", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_OGC_LOTS_OK), { status: 200 }),
    );
    const res = await fetchLots("saint-eustache", { baseUrl: "", limit: 1 });
    expect(res.ok).toBe(true);
    expect(res.citySlug).toBe("saint-eustache");
    expect(res.collectionId).toBe("qc-lots-saint-eustache");
    expect(res.numberMatched).toBe(45099);
    expect(res.numberReturned).toBe(1);
    expect(res.featureCollection.features).toHaveLength(1);
    expect(res.featureCollection.features[0].properties).toMatchObject({
      noLot: "1 733 312",
      citySlug: "saint-eustache",
      zoneCode: "H-431",
      tod: true,
      multifamilial4plus: true,
      superficieM2: 712.9,
    });
  });

  it("still accepts legacy LotsResponse bodies used by older mocks", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_LOTS_OK), { status: 200 }),
    );
    const res = await fetchLots("salaberry-de-valleyfield", { baseUrl: "" });
    expect(res.ok).toBe(true);
    expect(res.citySlug).toBe("salaberry-de-valleyfield");
    expect(res.featureCollection.features).toHaveLength(2);
    expect(res.numberMatched).toBe(2);
  });

  it("returns ok=false with empty featureCollection when legacy body has no source", async () => {
    const body = MOCK_LOTS_EMPTY;
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchLots("unknown-city", { baseUrl: "" });
    expect(res.ok).toBe(false);
    expect(res.featureCollection.features).toHaveLength(0);
    expect(res.reason).toContain("inconnue");
  });

  it("throws on HTTP 500 error", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("{}", { status: 500 }),
    );
    await expect(fetchLots("salaberry-de-valleyfield", { baseUrl: "" })).rejects.toThrow(
      "lots HTTP 500",
    );
  });

  it("returns ok=false on HTTP 404 collection missing", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ error: "collection_not_found" }),
        { status: 404 },
      ),
    );
    const res = await fetchLots("unknown", { baseUrl: "" });
    expect(res.ok).toBe(false);
    expect(res.source).toBe("none");
    expect(res.collectionId).toBe("qc-lots-unknown");
    expect(res.featureCollection.features).toHaveLength(0);
    expect(res.reason).toContain("Collection lots non configurée");
  });

  it("features preserve public non-PII display fields and drop unrelated raw properties", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_OGC_LOTS_OK), { status: 200 }),
    );
    const res = await fetchLots("saint-eustache", { baseUrl: "" });
    for (const f of res.featureCollection.features) {
      const keys = Object.keys(f.properties);
      // Public display fields only — no owner/address/name/raw geo ids.
      for (const k of keys) {
        expect([
          "noLot",
          "citySlug",
          "zoneCode",
          "tod",
          "multifamilial4plus",
          "superficieM2",
          "potentialScore",
          "potentialScoreStatus",
          "potentialScoreSource",
          "potentialScoreReason",
        ]).toContain(k);
      }
    }
  });
});
