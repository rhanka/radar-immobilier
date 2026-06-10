/**
 * Tests unitaires du service lotsForCity.
 *
 * Fixture cadastre : imite une réponse MapServer MRNF réelle avec
 * 3 lots NO_LOT réels de Salaberry-de-Valleyfield.
 * Anti-invention : aucun propriétaire, aucune PII.
 *
 * Tests ajoutés (2026-06-10, WP-B-lotsfix) :
 * - Construction d'URL correcte : geometry+spatialRel+outFields présents, where=1=1 absent.
 * - Bbox par défaut utilisée si opts.bbox absent.
 * - NO_LOT avec espaces (format réel MRNF) correctement extrait.
 */
import { describe, expect, it } from "vitest";
import { lotsForCity, type LotFeatureCollectionT } from "./lots.js";

// ─── Fixture : réponse ArcGIS MapServer (imitée) ──────────────────────────────
// Source : structure confirmée par requête HTTP 200 sur le Cadastre_allege MRNF
// (2026-05-25). Seul champ retenu : NO_LOT (identifiant cadastral public).
// PAS de nom de propriétaire ni d'adresse.
const CADASTRE_FIXTURE_VALLEYFIELD = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-74.131, 45.271],
            [-74.130, 45.271],
            [-74.130, 45.272],
            [-74.131, 45.272],
            [-74.131, 45.271],
          ],
        ],
      },
      properties: {
        NO_LOT: "4193751",
        // Champ supplémentaire présent sur le service réel — doit être ignoré.
        OBJECTID: 123456,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-74.132, 45.271],
            [-74.131, 45.271],
            [-74.131, 45.272],
            [-74.132, 45.272],
            [-74.132, 45.271],
          ],
        ],
      },
      properties: {
        NO_LOT: "4193752",
        OBJECTID: 123457,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-74.133, 45.271],
            [-74.132, 45.271],
            [-74.132, 45.272],
            [-74.133, 45.272],
            [-74.133, 45.271],
          ],
        ],
      },
      properties: {
        NO_LOT: "4193753",
        OBJECTID: 123458,
      },
    },
  ],
};

/** fetchImpl qui retourne la fixture cadastre. */
function makeCadastreFetch(
  body: unknown = CADASTRE_FIXTURE_VALLEYFIELD,
  status = 200,
): typeof fetch {
  return (async (_url: string | URL | Request) => {
    if (status !== 200) {
      return new Response(null, { status });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// ─── Tests service ────────────────────────────────────────────────────────────

describe("lotsForCity — ville avec source donnees-quebec", () => {
  it("retourne un FeatureCollection normalisé avec les noLot attendus", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch(),
    });

    expect(result.ok).toBe(true);
    expect(result.citySlug).toBe("salaberry-de-valleyfield");
    expect(result.source).toBe("donnees-quebec");
    expect(result.featureCollection.type).toBe("FeatureCollection");
    expect(result.featureCollection.features).toHaveLength(3);

    const noLots = result.featureCollection.features.map(
      (f) => f.properties.noLot,
    );
    expect(noLots).toContain("4193751");
    expect(noLots).toContain("4193752");
    expect(noLots).toContain("4193753");
  });

  it("ne lève pas de PII : aucun champ au-delà de noLot et citySlug", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch(),
    });

    for (const feature of result.featureCollection.features) {
      const keys = Object.keys(feature.properties);
      expect(keys.sort()).toEqual(["citySlug", "noLot"]);
    }
  });

  it("le citySlug est propagé dans chaque feature.properties", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch(),
    });

    for (const feature of result.featureCollection.features) {
      expect(feature.properties.citySlug).toBe("salaberry-de-valleyfield");
    }
  });

  it("la géométrie est préservée (type Polygon)", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch(),
    });

    for (const feature of result.featureCollection.features) {
      expect(feature.geometry?.type).toBe("Polygon");
    }
  });

  it("retourne ok:false + FeatureCollection vide si upstream HTTP 503", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch({}, 503),
    });

    expect(result.ok).toBe(false);
    expect(result.featureCollection.features).toHaveLength(0);
    expect(result.reason).toContain("503");
  });
});

describe("lotsForCity — ville sans source lots", () => {
  it("retourne ok:false + FeatureCollection vide pour une ville inconnue", async () => {
    const result = await lotsForCity("ville-inexistante", {
      fetchImpl: makeCadastreFetch(),
    });

    expect(result.ok).toBe(false);
    expect(result.source).toBe("none");
    expect(result.featureCollection.type).toBe("FeatureCollection");
    expect(result.featureCollection.features).toHaveLength(0);
    expect(result.reason).toBeTruthy();
  });

  it("ne fait PAS d'appel réseau pour une ville inconnue", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await lotsForCity("ville-inexistante", { fetchImpl: spy });
    expect(called).toBe(false);
  });
});

describe("lotsForCity — Beauharnois (même couche MRNF)", () => {
  it("retourne des lots pour Beauharnois via la même source cadastre", async () => {
    const result = await lotsForCity("beauharnois", {
      fetchImpl: makeCadastreFetch(),
    });

    expect(result.ok).toBe(true);
    expect(result.citySlug).toBe("beauharnois");
    expect(result.source).toBe("donnees-quebec");
    expect(result.featureCollection.features).toHaveLength(3);
  });
});

describe("lotsForCity — réponse ArcGIS malformée", () => {
  it("retourne ok:false si la réponse n'est pas un FeatureCollection valide", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch({ error: "service unavailable" }),
    });

    expect(result.ok).toBe(false);
    expect(result.featureCollection.features).toHaveLength(0);
  });
});

describe("lotsForCity — typage LotFeatureCollection (compile-time)", () => {
  it("le résultat est compatible avec LotFeatureCollectionT", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch(),
    });

    // Type guard : doit compiler sans cast
    const fc: LotFeatureCollectionT = result.featureCollection;
    expect(fc.type).toBe("FeatureCollection");
  });
});

// ─── Tests construction d'URL (WP-B-lotsfix) ─────────────────────────────────

describe("lotsForCity — construction URL ArcGIS correcte (WP-B-lotsfix)", () => {
  /** Capture l'URL appelée et retourne une FeatureCollection vide. */
  function makeCaptureFetch(): { fn: typeof fetch; getUrl: () => string | undefined } {
    let captured: string | undefined;
    const fn = (async (url: string | URL | Request) => {
      captured = String(url);
      return new Response(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    return { fn, getUrl: () => captured };
  }

  it("l'URL contient geometry= et geometryType=esriGeometryEnvelope", async () => {
    const { fn, getUrl } = makeCaptureFetch();
    await lotsForCity("salaberry-de-valleyfield", { fetchImpl: fn });
    const url = getUrl()!;
    expect(url).toContain("geometry=");
    expect(url).toContain("geometryType=esriGeometryEnvelope");
  });

  it("l'URL contient spatialRel=esriSpatialRelIntersects", async () => {
    const { fn, getUrl } = makeCaptureFetch();
    await lotsForCity("salaberry-de-valleyfield", { fetchImpl: fn });
    const url = getUrl()!;
    expect(url).toContain("spatialRel=esriSpatialRelIntersects");
  });

  it("l'URL contient outFields=NO_LOT", async () => {
    const { fn, getUrl } = makeCaptureFetch();
    await lotsForCity("salaberry-de-valleyfield", { fetchImpl: fn });
    const url = getUrl()!;
    expect(url).toContain("outFields=NO_LOT");
  });

  it("l'URL NE contient PAS where=1%3D1 (requête non bornée)", async () => {
    const { fn, getUrl } = makeCaptureFetch();
    await lotsForCity("salaberry-de-valleyfield", { fetchImpl: fn });
    const url = getUrl()!;
    // where=1=1 encodeé est where=1%3D1 ou where=1%3d1
    expect(url.toLowerCase()).not.toContain("where=1%3d1");
    expect(url).not.toContain("where=1=1");
  });

  it("opts.bbox fournie est encodée dans l'URL geometry", async () => {
    const { fn, getUrl } = makeCaptureFetch();
    const customBbox: [number, number, number, number] = [-74.15, 45.25, -74.10, 45.30];
    await lotsForCity("salaberry-de-valleyfield", { fetchImpl: fn, bbox: customBbox });
    const url = getUrl()!;
    // La bbox doit apparaître dans le paramètre geometry encodé
    expect(url).toContain("geometry=");
    expect(url).toContain("-74.15");
  });

  it("sans opts.bbox, la bbox par défaut de la ville est utilisée", async () => {
    const { fn, getUrl } = makeCaptureFetch();
    await lotsForCity("salaberry-de-valleyfield", { fetchImpl: fn });
    const url = getUrl()!;
    // La bbox par défaut de Valleyfield contient -74.16 (xmin)
    expect(url).toContain("-74.16");
  });
});

describe("lotsForCity — NO_LOT format MRNF avec espaces", () => {
  /** Fixture avec NO_LOT au format réel MRNF (espaces dans le numéro). */
  const FIXTURE_ESPACES = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: null,
        properties: {
          NO_LOT: "4 516 943",
          OBJECTID: 99,
        },
      },
      {
        type: "Feature",
        geometry: null,
        properties: {
          NO_LOT: "3 818 335",
          OBJECTID: 100,
        },
      },
    ],
  };

  it("NO_LOT avec espaces est préservé tel quel dans noLot", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch(FIXTURE_ESPACES),
    });

    expect(result.ok).toBe(true);
    const noLots = result.featureCollection.features.map((f) => f.properties.noLot);
    expect(noLots).toContain("4 516 943");
    expect(noLots).toContain("3 818 335");
  });

  it("pas de PII même avec NO_LOT espacé", async () => {
    const result = await lotsForCity("salaberry-de-valleyfield", {
      fetchImpl: makeCadastreFetch(FIXTURE_ESPACES),
    });

    for (const feature of result.featureCollection.features) {
      const keys = Object.keys(feature.properties).sort();
      expect(keys).toEqual(["citySlug", "noLot"]);
    }
  });
});
