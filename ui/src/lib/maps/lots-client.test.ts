import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchAllLots,
  fetchLots,
  lotsCollectionId,
  resolveLotsUrl,
  type LotsResponse,
  type LotFeature,
} from "./lots-client.js";
import { facadeDisplay } from "$lib/components/maps/lot-fiche-utils.js";

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
          "codePostal",
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

// ── Superficie RÉELLE servie par geo : `surface_m2` (aire du polygone, m²) ────
// `superficie_m2` était un nom MORT jamais servi par geo (bug de mapping #350).

describe("superficieM2 ← surface_m2 (geo)", () => {
  async function mapLot(properties: Record<string, unknown>) {
    const body = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: { noLot: "L-S", ...properties } }],
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchLots("delson", { baseUrl: "" });
    return res.featureCollection.features[0].properties;
  }

  it("surface_m2 servi → superficie affichée (mappé sur superficieM2)", async () => {
    const props = await mapLot({ surface_m2: 6116.71 });
    expect(props.superficieM2).toBe(6116.71);
  });

  it("surface_m2 PRIME sur la superficie calculée de la source", async () => {
    const props = await mapLot({ surface_m2: 6116.71, superficie_m2_calculee: 5000 });
    expect(props.superficieM2).toBe(6116.71);
  });

  it("absent → undefined (fiche « — », AUCUN calcul immo)", async () => {
    const props = await mapLot({});
    expect(props.superficieM2).toBeUndefined();
  });

  it("le nom MORT superficie_m2 n'est PLUS lu (jamais servi par geo)", async () => {
    const props = await mapLot({ superficie_m2: 999 });
    expect(props.superficieM2).toBeUndefined();
  });
});

// ── Code postal servi par geo (FSA 3 caractères, affiché tel quel) ────────────

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

  it("FSA 3 caractères servi par geo (ex. « J3Y ») → remonté tel quel", async () => {
    const body = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: { noLot: "L-11", code_postal: "J3Y" },
        },
      ],
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchLots("longueuil", { baseUrl: "" });
    expect(res.featureCollection.features[0].properties.codePostal).toBe("J3Y");
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

// ── Normes de zonage foldées par lot (contrat geo `<norme>_value`/`_unit`) ────
// geo sert les normes par lot via zone_code, verbatim-or-null. La paire
// valeur/unité est composée « valeur unité » ; valeur seule quand l'unité
// n'est pas servie ; rien d'inventé quand rien n'est servi.

describe("normes foldées par lot (geo)", () => {
  async function mapLot(properties: Record<string, unknown>) {
    const body = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: { noLot: "L-N", ...properties } }],
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const res = await fetchLots("delson", { baseUrl: "" });
    return res.featureCollection.features[0].properties;
  }

  it("compose valeur + unité verbatim (hauteur_max_value/_unit, densite_value/_unit)", async () => {
    const props = await mapLot({
      hauteur_max_value: 12.5,
      hauteur_max_unit: "m",
      densite_value: 35,
      densite_unit: "log/ha",
    });
    expect(props.normes?.hauteur).toBe("12.5 m");
    expect(props.normes?.densite).toBe("35 log/ha");
  });

  it("valeur seule quand l'unité n'est pas servie (aucune unité inventée)", async () => {
    const props = await mapLot({
      frontage_min_value: 15,
      superficie_min_value: 460,
      marge_avant_min_value: 6,
      marge_laterale_min_value: 2,
      marge_arriere_min_value: 7.5,
    });
    expect(props.normes?.frontageMin).toBe("15");
    expect(props.normes?.superficieMin).toBe("460");
    expect(props.normes?.margeAvant).toBe("6");
    expect(props.normes?.margeLaterale).toBe("2");
    expect(props.normes?.margeArriere).toBe("7.5");
  });

  it("superficie_min (NORME) reste DISTINCTE de surface_m2 (aire réelle)", async () => {
    const props = await mapLot({
      surface_m2: 6116.71,
      superficie_min_value: 460,
      superficie_min_unit: "m²",
      frontage_m: 22.9,
      frontage_min_value: 15,
    });
    expect(props.superficieM2).toBe(6116.71);
    expect(props.normes?.superficieMin).toBe("460 m²");
    expect(props.facadeM).toBe(22.9);
    expect(props.normes?.frontageMin).toBe("15");
  });

  it("in_tod (geo) foldé sur le flag TOD", async () => {
    const props = await mapLot({ in_tod: true });
    expect(props.tod).toBe(true);
  });

  it("aucune norme servie → normes undefined (fiche « — »)", async () => {
    const props = await mapLot({});
    expect(props.normes).toBeUndefined();
  });
});

// ── Façade canonique geo (frontage_m) ─────────────────────────────────────────
// Décision : la façade CANONIQUE du lot est servie par geo (`frontage_m`).
// Elle est mappée sur `facadeM` (champ consommé par la fiche) et PRIME sur la
// `facade_m` de la source — la fiche l'affiche alors SANS mention « estimée ».

async function fetchSingleLot(
  properties: Record<string, unknown>,
  geometry: Record<string, unknown> | null = null,
): Promise<LotsResponse> {
  const body = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry, properties }],
  };
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify(body), { status: 200 }),
  );
  return fetchLots("delson", { baseUrl: "" });
}

describe("frontage_m — façade canonique servie par geo", () => {
  it("normalise frontage_m vers facadeM", async () => {
    const res = await fetchSingleLot({ noLot: "L-20", frontage_m: 22.9 });
    expect(res.featureCollection.features[0].properties.facadeM).toBe(22.9);
  });

  it("préfère frontage_m (canonique geo) à facade_m (source)", async () => {
    const res = await fetchSingleLot({
      noLot: "L-21",
      frontage_m: 22.9,
      facade_m: 18.2,
    });
    expect(res.featureCollection.features[0].properties.facadeM).toBe(22.9);
  });

  it("repli facade_m source quand frontage_m absent", async () => {
    const res = await fetchSingleLot({ noLot: "L-22", facade_m: 18.2 });
    expect(res.featureCollection.features[0].properties.facadeM).toBe(18.2);
  });

  it("aucune façade servie → undefined (repli estimation immo côté fiche)", async () => {
    const res = await fetchSingleLot({ noLot: "L-23" });
    expect(res.featureCollection.features[0].properties.facadeM).toBeUndefined();
  });

  it("fiche : frontage_m présent → façade affichée SANS « estimée » ; absent → estimation « ≈ … (estimée) »", async () => {
    // Petit rectangle ~20 m × 40 m (approx. équirectangulaire à 45,4° N).
    const dLon = 20 / (111320 * Math.cos((45.4 * Math.PI) / 180));
    const dLat = 40 / 111320;
    const geometry = {
      type: "Polygon",
      coordinates: [[
        [-73.5, 45.4],
        [-73.5 + dLon, 45.4],
        [-73.5 + dLon, 45.4 + dLat],
        [-73.5, 45.4 + dLat],
        [-73.5, 45.4],
      ]],
    };
    const withFrontage = await fetchSingleLot(
      { noLot: "L-24", frontage_m: 22.9 },
      geometry,
    );
    const canonical = facadeDisplay(withFrontage.featureCollection.features[0]);
    expect(canonical).toContain("22,9");
    expect(canonical).not.toContain("estimée");

    const withoutFrontage = await fetchSingleLot({ noLot: "L-25" }, geometry);
    const estimated = facadeDisplay(withoutFrontage.featureCollection.features[0]);
    expect(estimated).toMatch(/^≈ /u);
    expect(estimated).toContain("(estimée)");
  });
});

// ── Provenance du règlement porteur (zone de norme) mappée sur zone{...} ───────

describe("provenance du règlement (zone de norme) → zone{reglement*}", () => {
  it("mappe l'objet zone servi par geo (snake_case) vers camelCase", async () => {
    const res = await fetchSingleLot({
      noLot: "R-1",
      zone: {
        code: "H-241",
        kind: "H",
        usages: [],
        densiteLogHa: null,
        grillePdfUrl: null,
        reglement_numero: "2008-102",
        reglement_millesime: 2008,
        reglement_page_source: "12",
        reglement_url: "https://ville.qc.ca/reglements/2008-102.pdf",
      },
    });
    const zone = res.featureCollection.features[0].properties.zone;
    expect(zone).toMatchObject({
      reglementNumero: "2008-102",
      reglementMillesime: 2008,
      reglementPageSource: "12",
      reglementUrl: "https://ville.qc.ca/reglements/2008-102.pdf",
    });
  });

  it("provenance à plat sur les properties (fallback) → foldée dans zone", async () => {
    const res = await fetchSingleLot({
      noLot: "R-2",
      zone_code: "H-9",
      reglement_numero: "1926-26",
      reglement_url: "https://x/1926-26.pdf",
    });
    const zone = res.featureCollection.features[0].properties.zone;
    expect(zone).toMatchObject({
      reglementNumero: "1926-26",
      reglementUrl: "https://x/1926-26.pdf",
    });
    expect(zone?.reglementMillesime ?? null).toBeNull();
  });

  it("aucune provenance servie → aucun champ reglement* (anti-invention)", async () => {
    const res = await fetchSingleLot({
      noLot: "R-3",
      zone: { code: "H-1", kind: "H", usages: [], densiteLogHa: null },
    });
    const zone = res.featureCollection.features[0].properties.zone;
    expect(zone?.reglementNumero).toBeUndefined();
    expect(zone?.reglementUrl).toBeUndefined();
  });
});

describe("usage dominant (qc-zonage) → zone{usageDominant,usageDominantSource}", () => {
  it("mappe l'objet zone servi par geo (snake_case) vers camelCase", async () => {
    const res = await fetchSingleLot({
      noLot: "U-1",
      zone: {
        code: "AD-1",
        kind: "A",
        usages: [],
        densiteLogHa: null,
        usage_dominant: "agricole",
        usage_dominant_source: "zone-nomenclature",
      },
    });
    const zone = res.featureCollection.features[0].properties.zone;
    expect(zone).toMatchObject({
      usageDominant: "agricole",
      usageDominantSource: "zone-nomenclature",
    });
  });

  it("usage dominant à plat sur les properties (fallback) → foldé dans zone", async () => {
    const res = await fetchSingleLot({
      noLot: "U-2",
      zone_code: "H-9",
      usage_dominant: "residentiel",
      usage_dominant_source: "zone-nomenclature",
    });
    const zone = res.featureCollection.features[0].properties.zone;
    expect(zone).toMatchObject({
      usageDominant: "residentiel",
      usageDominantSource: "zone-nomenclature",
    });
  });

  it("aucun usage dominant servi → aucun champ (anti-invention)", async () => {
    const res = await fetchSingleLot({
      noLot: "U-3",
      zone: { code: "H-1", kind: "H", usages: [], densiteLogHa: null },
    });
    const zone = res.featureCollection.features[0].properties.zone;
    expect(zone?.usageDominant).toBeUndefined();
    expect(zone?.usageDominantSource).toBeUndefined();
  });
});

describe("enveloppes de provenance geo", () => {
  it("conserve proof et immo_zone_lot_provenance sans les reformater", async () => {
    const proof = {
      schema_version: "1.0",
      status: "partial",
      sources: {
        geometry: { status: "available", artifact_uri: "https://geo.example/lots.geojson", upstream_uri: null },
        regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
      },
      zone: null,
      gaps: ["regulation_source_unavailable"],
    };
    const provenance = {
      contract: "immo-zone-lot-provenance/v1",
      assessed_at: "2026-07-22T14:00:00Z",
      lot_assignment_evidence: {
        state: "recorded",
        selected_zone: { collection: "qc-zonage-delson", feature_ref: null, code: "H-12" },
        assignment_method: "area-majority",
        dominant_fraction: 0.94,
        multi_zone: false,
        zone_codes: ["H-12"],
        evidence_snapshot: "2026-06-21",
        evidence_id: "lot-zone-ev-7d21",
        reason_codes: [],
      },
      zone_geometry_provenance: null,
      acquisition_v2_readiness: { state: "not-ready", checked_at: null, unmet_requirement_codes: ["missing-content-sha256"] },
    };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: null, properties: { NO_LOT: "P-1", proof, immo_zone_lot_provenance: provenance } }] }), { status: 200 }));
    const response = await fetchLots("delson", { baseUrl: "" });
    expect(response.featureCollection.features[0]!.properties.proof).toEqual(proof);
    expect(response.featureCollection.features[0]!.properties.immo_zone_lot_provenance).toEqual(provenance);
  });
});
