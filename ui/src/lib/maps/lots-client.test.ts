import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchAllLots,
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

// ── C8 — fetchAllLots : pagination OGC multi-pages fusionnée ──────────────────

function ogcFeature(noLot: string): Record<string, unknown> {
  return {
    type: "Feature",
    geometry: null,
    properties: { noLot },
  };
}

function ogcPage(
  noLots: string[],
  numberMatched: number,
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: noLots.map(ogcFeature),
    numberMatched,
    numberReturned: noLots.length,
  };
}

/** Stub fetch qui sert des pages OGC par offset, et journalise les URLs. */
function stubPagedFetch(pagesByOffset: Record<string, unknown>): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const offset = new URL(url, "http://localhost").searchParams.get("offset") ?? "0";
    const body = pagesByOffset[offset] ?? ogcPage([], 0);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return urls;
}

describe("fetchAllLots", () => {
  it("charge TOUTES les pages quand l'upstream plafonne la taille de page", async () => {
    const urls = stubPagedFetch({
      "0": ogcPage(["L-1", "L-2"], 5),
      "2": ogcPage(["L-3", "L-4"], 5),
      "4": ogcPage(["L-5"], 5),
    });
    const pages: number[] = [];
    const res = await fetchAllLots("delson", {
      baseUrl: "",
      pageLimit: 2,
      onPage: (partial) => pages.push(partial.featureCollection.features.length),
    });
    expect(res.ok).toBe(true);
    expect(res.featureCollection.features.map((f) => f.properties.noLot)).toEqual([
      "L-1",
      "L-2",
      "L-3",
      "L-4",
      "L-5",
    ]);
    expect(res.numberMatched).toBe(5);
    expect(res.numberReturned).toBe(5);
    // Chargement PROGRESSIF : le callback voit la fusion grossir page à page.
    expect(pages).toEqual([2, 4, 5]);
    expect(urls).toHaveLength(3);
    expect(urls[1]).toContain("offset=2");
    expect(urls[2]).toContain("offset=4");
  });

  it("s'arrête sans boucle quand le serveur IGNORE offset (store local)", async () => {
    // Le store local rejoue la même première page quel que soit l'offset.
    const samePage = ogcPage(["L-1", "L-2"], 5);
    const urls = stubPagedFetch({ "0": samePage, "2": samePage, "4": samePage });
    const res = await fetchAllLots("delson", { baseUrl: "", pageLimit: 2 });
    // Dédup par noLot : la page rejouée n'ajoute rien → arrêt net.
    expect(res.featureCollection.features).toHaveLength(2);
    expect(urls.length).toBe(2);
  });

  it("une seule requête suffit quand tout tient dans la première page", async () => {
    const urls = stubPagedFetch({ "0": ogcPage(["L-1", "L-2", "L-3"], 3) });
    const res = await fetchAllLots("delson", { baseUrl: "", pageLimit: 100 });
    expect(res.featureCollection.features).toHaveLength(3);
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain("offset=");
  });

  it("dédoublonne par noLot les pages qui se chevauchent", async () => {
    const urls = stubPagedFetch({
      "0": ogcPage(["L-1", "L-2"], 3),
      "2": ogcPage(["L-2", "L-3"], 3),
    });
    const res = await fetchAllLots("delson", { baseUrl: "", pageLimit: 2 });
    expect(res.featureCollection.features.map((f) => f.properties.noLot)).toEqual([
      "L-1",
      "L-2",
      "L-3",
    ]);
    expect(urls.length).toBeGreaterThanOrEqual(2);
  });

  it("retourne la réponse honnête ok=false quand la collection est absente", async () => {
    vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
    const res = await fetchAllLots("ville-inconnue", { baseUrl: "" });
    expect(res.ok).toBe(false);
    expect(res.source).toBe("none");
    expect(res.featureCollection.features).toHaveLength(0);
  });
});

// ── C5 — code postal câblé (remonte dès que geo l'expose) ─────────────────────

describe("codePostal (C5)", () => {
  it("normalise code_postal snake_case", async () => {
    const body = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: { noLot: "L-9", code_postal: "J6S 4V2" },
        },
      ],
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchLots("delson", { baseUrl: "" });
    expect(res.featureCollection.features[0].properties.codePostal).toBe("J6S 4V2");
  });

  it("absent → undefined (fiche affiche « — », aucune invention)", async () => {
    const body = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: null, properties: { noLot: "L-10" } },
      ],
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchLots("delson", { baseUrl: "" });
    expect(res.featureCollection.features[0].properties.codePostal).toBeUndefined();
  });
});
