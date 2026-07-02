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
        priorite: true,
        superficie_m2_calculee: 712.9,
        // Champs publics du rôle, noms BRUTS carte de référence CS-L6.
        adresse: "12 rue Principale",
        facade_m: 18.2,
        profondeur_m: 39.1,
        categorie: "Résidentiel",
        cubf: "1000",
        val_totale: 385000,
        val_terrain: 120000,
        val_batiment: 265000,
        nb_logements_role: 4,
        annee_construction: "1987",
        zone_desc: "Min 16 log \u00b7 6 \u00e9tages \u00b7 Mixte",
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
      priorite: true,
      superficieM2: 712.9,
      adresse: "12 rue Principale",
      facadeM: 18.2,
      profondeurM: 39.1,
      zoneDescription: "Min 16 log \u00b7 6 \u00e9tages \u00b7 Mixte",
      usageCode: "1000",
      valuation: {
        usageCode: "1000",
        categorie: "Résidentiel",
        valeurTotale: 385000,
        valeurTerrain: 120000,
        valeurBatiment: 265000,
        nbLogements: 4,
        anneeConstruction: 1987,
      },
    });
  });

  it("traite les placeholders de zone (N/D) comme absence honnête", async () => {
    const body = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: { NO_LOT: "2 181 127", zone: "N/D" },
        },
      ],
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchLots("delson", { baseUrl: "" });
    expect(res.featureCollection.features[0].properties.zoneCode).toBeUndefined();
  });

  it("normalise les normes verbatim (objet dédié ou champs à plat)", async () => {
    const body = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: {
            NO_LOT: "1",
            normes: { hauteur: "9,0 m", marge_avant: "6 m", densite: 35 },
          },
        },
        {
          type: "Feature",
          geometry: null,
          properties: { NO_LOT: "2", hauteur_max: "2 étages" },
        },
        {
          type: "Feature",
          geometry: null,
          properties: { NO_LOT: "3" },
        },
      ],
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchLots("salaberry-de-valleyfield", { baseUrl: "" });
    const [a, b, c] = res.featureCollection.features.map((f) => f.properties);
    expect(a.normes).toMatchObject({ hauteur: "9,0 m", margeAvant: "6 m", densite: "35" });
    expect(b.normes).toMatchObject({ hauteur: "2 étages" });
    expect(c.normes).toBeUndefined();
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
      // Public display fields only — no owner name, no raw geo ids.
      // `adresse` = adresse civique du LOT (donnée publique du rôle,
      // identifie la propriété — jamais une personne).
      for (const k of keys) {
        expect([
          "noLot",
          "citySlug",
          "zoneCode",
          "zoneDescription",
          "tod",
          "multifamilial4plus",
          "priorite",
          "adresse",
          "facadeM",
          "profondeurM",
          "superficieM2",
          "usageCode",
          "valuation",
          "normes",
          "zone",
          "grillePdfUrl",
          "potentialScore",
          "potentialScoreStatus",
          "potentialScoreSource",
          "potentialScoreReason",
        ]).toContain(k);
      }
    }
  });
});
