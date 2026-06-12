/**
 * Tests de l'endpoint GET /api/geo/:city/lots.
 * fetchImpl mocké — pas d'appel réseau.
 */
import { describe, expect, it } from "vitest";
import { geoLotsRoute, type ZoneVersionProvider } from "./geo-lots.js";
import type { ZoneVersionInput } from "../services/scoring/lot-potential.js";

// ─── Fixture ──────────────────────────────────────────────────────────────────
const VALLEYFIELD_FC = {
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
      properties: { NO_LOT: "4193751", OBJECTID: 1 },
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
      properties: { NO_LOT: "4193752", OBJECTID: 2 },
    },
  ],
};

function makeOkFetch(body: unknown = VALLEYFIELD_FC): typeof fetch {
  return (async (_url: string | URL | Request) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function makeFailFetch(status: number): typeof fetch {
  return (async (_url: string | URL | Request) =>
    new Response(null, { status })) as unknown as typeof fetch;
}

// ─── Tests endpoint ──────────────────────────────────────────────────────────

describe("GET /api/geo/:city/lots — ville connue avec source cadastre", () => {
  it("retourne 200 + shape { ok, citySlug, source, featureCollection }", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request(
      "/api/geo/salaberry-de-valleyfield/lots",
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      citySlug: string;
      source: string;
      featureCollection: { type: string; features: unknown[] };
    };

    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("salaberry-de-valleyfield");
    expect(body.source).toBe("donnees-quebec");
    expect(body.featureCollection.type).toBe("FeatureCollection");
    expect(body.featureCollection.features).toHaveLength(2);
  });

  it("les features ne contiennent pas de PII (noLot + citySlug + potentialScore uniquement)", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: Record<string, unknown> }[] };
    };

    for (const f of body.featureCollection.features) {
      const keys = Object.keys(f.properties).sort();
      expect(keys).toEqual(["citySlug", "noLot", "potentialScore"]);
    }
  });

  it("accepte le param ?limit=10 et le transmet au service", async () => {
    let capturedUrl: string | undefined;
    const captureFetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const app = geoLotsRoute({ fetchImpl: captureFetch });
    const res = await app.request(
      "/api/geo/salaberry-de-valleyfield/lots?limit=10",
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("resultRecordCount=10");
  });

  it("accepte le param ?bbox= et l'inclut dans la requête MRNF", async () => {
    let capturedUrl: string | undefined;
    const captureFetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const app = geoLotsRoute({ fetchImpl: captureFetch });
    const res = await app.request(
      "/api/geo/salaberry-de-valleyfield/lots?bbox=-74.15,45.25,-74.10,45.30",
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("geometry=");
  });
});

describe("GET /api/geo/:city/lots — ville inconnue", () => {
  it("retourne 404 pour une ville absente de l'inventaire", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/ville-fantome/lots");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; source: string };
    expect(body.ok).toBe(false);
    expect(body.source).toBe("none");
  });
});

describe("GET /api/geo/:city/lots — upstream en erreur", () => {
  it("retourne 502 si MRNF répond 503", async () => {
    const app = geoLotsRoute({ fetchImpl: makeFailFetch(503) });
    const res = await app.request(
      "/api/geo/salaberry-de-valleyfield/lots",
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

describe("GET /api/geo/:city/lots — params invalides", () => {
  it("retourne 400 pour ?limit=0", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request(
      "/api/geo/salaberry-de-valleyfield/lots?limit=0",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid-param");
  });

  it("retourne 400 pour ?bbox= malformé", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request(
      "/api/geo/salaberry-de-valleyfield/lots?bbox=abc",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid-param");
  });
});

// ─── Tests score de potentiel dans l'endpoint ─────────────────────────────────

describe("GET /api/geo/:city/lots — potentialScore dans les features", () => {
  it("sans zoneVersionProvider, potentialScore = 0 pour chaque lot (null safe)", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { potentialScore: number } }[] };
    };

    expect(res.status).toBe(200);
    for (const f of body.featureCollection.features) {
      // Sans contexte de zone : densiteLogHa=null → scoreBase=0, aucun bonus → 0
      expect(f.properties.potentialScore).toBe(0);
    }
  });

  it("potentialScore est un number (0–10)", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { potentialScore: unknown } }[] };
    };

    for (const f of body.featureCollection.features) {
      expect(typeof f.properties.potentialScore).toBe("number");
      expect(f.properties.potentialScore).toBeGreaterThanOrEqual(0);
      expect(f.properties.potentialScore).toBeLessThanOrEqual(10);
    }
  });

  it("avec zoneVersionProvider H + densité 80 → potentialScore 4.0", async () => {
    const provider: ZoneVersionProvider = (_noLot, _citySlug): ZoneVersionInput => ({
      densiteLogHa: 80,
      usages: [],
      kind: "H",
    });
    const app = geoLotsRoute({ fetchImpl: makeOkFetch(), zoneVersionProvider: provider });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { potentialScore: number } }[] };
    };

    expect(res.status).toBe(200);
    // scoreBase(80)=3 + bonusKind(H)=1 = 4.0
    for (const f of body.featureCollection.features) {
      expect(f.properties.potentialScore).toBe(4.0);
    }
  });

  it("avec zoneVersionProvider C + densité 250 → potentialScore 5.5", async () => {
    const provider: ZoneVersionProvider = (_noLot, _citySlug): ZoneVersionInput => ({
      densiteLogHa: 250,
      usages: [],
      kind: "C",
    });
    const app = geoLotsRoute({ fetchImpl: makeOkFetch(), zoneVersionProvider: provider });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { potentialScore: number } }[] };
    };

    // scoreBase(250)=5 + bonusReconvertible(C)=0.5 = 5.5
    for (const f of body.featureCollection.features) {
      expect(f.properties.potentialScore).toBe(5.5);
    }
  });

  it("provider retournant null → potentialScore 0 (zone inconnue)", async () => {
    const provider: ZoneVersionProvider = () => null;
    const app = geoLotsRoute({ fetchImpl: makeOkFetch(), zoneVersionProvider: provider });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { potentialScore: number } }[] };
    };

    for (const f of body.featureCollection.features) {
      expect(f.properties.potentialScore).toBe(0);
    }
  });

  it("score different selon noLot (provider per-lot)", async () => {
    const scoreMap: Record<string, number> = {
      "4193751": 4.0,  // lot 1 : zone H + densité 80
      "4193752": 5.5,  // lot 2 : zone C + densité 250
    };
    const provider: ZoneVersionProvider = (noLot): ZoneVersionInput => {
      if (noLot === "4193751") return { densiteLogHa: 80, usages: [], kind: "H" };
      if (noLot === "4193752") return { densiteLogHa: 250, usages: [], kind: "C" };
      return { densiteLogHa: null, usages: [], kind: "AUTRE" };
    };
    const app = geoLotsRoute({ fetchImpl: makeOkFetch(), zoneVersionProvider: provider });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: {
        features: { properties: { noLot: string; potentialScore: number } }[];
      };
    };

    for (const f of body.featureCollection.features) {
      if (scoreMap[f.properties.noLot] !== undefined) {
        expect(f.properties.potentialScore).toBe(scoreMap[f.properties.noLot]);
      }
    }
  });
});
