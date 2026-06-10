/**
 * Tests unitaires du service lotsForCity.
 *
 * Fixture cadastre : imite une réponse MapServer MRNF réelle avec
 * 3 lots NO_LOT réels de Salaberry-de-Valleyfield.
 * Anti-invention : aucun propriétaire, aucune PII.
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
