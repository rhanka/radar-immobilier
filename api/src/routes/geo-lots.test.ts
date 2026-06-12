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

  it("les features ne contiennent pas de PII (champs publics enrichis seulement)", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: Record<string, unknown> }[] };
    };

    for (const f of body.featureCollection.features) {
      const keys = Object.keys(f.properties).sort();
      // Champs publics enrichis : noLot, citySlug, superficieM2, usageCode, zone, potentialScore
      // Pas de nom propriétaire, pas d'adresse, pas de matricule
      expect(keys).toEqual(["citySlug", "noLot", "potentialScore", "superficieM2", "usageCode", "zone"]);
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

// ─── Tests carte Steve CS-L6 ─────────────────────────────────────────────────

describe("GET /api/geo/:city/lots — carte Steve (4 villes)", () => {
  it("delson : retourne 200 + source:'carte-steve' + mode:'carte-steve'", async () => {
    // Pas de fetchImpl : la route carte-steve ne fait pas de requête réseau
    const app = geoLotsRoute();
    const res = await app.request("/api/geo/delson/lots?limit=10");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      citySlug: string;
      source: string;
      mode: string;
      featureCollection: { type: string; features: unknown[] };
    };

    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("delson");
    expect(body.source).toBe("carte-steve");
    expect(body.mode).toBe("carte-steve");
    expect(body.featureCollection.type).toBe("FeatureCollection");
    expect(body.featureCollection.features).toHaveLength(10);
  });

  it("delson : les lots ont potentialScore non-nul (vrais lots scorés)", async () => {
    const app = geoLotsRoute();
    const res = await app.request("/api/geo/delson/lots?limit=50");
    const body = (await res.json()) as {
      featureCollection: {
        features: { properties: { potentialScore: number | null; zone: string } }[];
      };
    };

    const scoredLots = body.featureCollection.features.filter(
      (f) => (f.properties.potentialScore ?? 0) > 0,
    );
    expect(scoredLots.length).toBeGreaterThan(0);
  });

  it("sainte-catherine : retourne 200 avec lots carte-steve", async () => {
    const app = geoLotsRoute();
    const res = await app.request("/api/geo/sainte-catherine/lots?limit=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: string };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("carte-steve");
  });

  it("saint-constant : retourne 200 avec lots carte-steve", async () => {
    const app = geoLotsRoute();
    const res = await app.request("/api/geo/saint-constant/lots?limit=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: string };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("carte-steve");
  });

  it("candiac : retourne 200 avec lots carte-steve (score partiel : pas de zones)", async () => {
    const app = geoLotsRoute();
    const res = await app.request("/api/geo/candiac/lots?limit=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: string };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("carte-steve");
  });

  it("les lots carte-steve ont mode:'carte-steve' dans properties", async () => {
    const app = geoLotsRoute();
    const res = await app.request("/api/geo/delson/lots?limit=5");
    const body = (await res.json()) as {
      featureCollection: {
        features: { properties: { mode: string } }[];
      };
    };
    for (const f of body.featureCollection.features) {
      expect(f.properties.mode).toBe("carte-steve");
    }
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

// ─── Tests enrichissement superficieM2, usageCode, zone ──────────────────────

describe("GET /api/geo/:city/lots — enrichissement superficieM2 / usageCode / zone", () => {
  it("superficieM2 est calculée depuis la géométrie Polygon (> 0)", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { superficieM2: unknown } }[] };
    };

    expect(res.status).toBe(200);
    for (const f of body.featureCollection.features) {
      // La fixture a des polygones ~0.001°×0.001° ~ 7 700 m² à lat 45°
      expect(typeof f.properties.superficieM2).toBe("number");
      expect(f.properties.superficieM2 as number).toBeGreaterThan(0);
    }
  });

  it("superficieM2 est arrondie à 1 décimale", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { superficieM2: unknown } }[] };
    };

    for (const f of body.featureCollection.features) {
      const s = f.properties.superficieM2 as number;
      expect(s).toBe(Math.round(s * 10) / 10);
    }
  });

  it("superficieM2 = null si géométrie absente", async () => {
    const fcNullGeom = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: { NO_LOT: "9999999", OBJECTID: 99 },
        },
      ],
    };
    const app = geoLotsRoute({ fetchImpl: makeOkFetch(fcNullGeom) });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { superficieM2: unknown } }[] };
    };

    expect(res.status).toBe(200);
    for (const f of body.featureCollection.features) {
      expect(f.properties.superficieM2).toBeNull();
    }
  });

  it("usageCode = null (non disponible dans ce flux, anti-invention)", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: { features: { properties: { usageCode: unknown } }[] };
    };

    for (const f of body.featureCollection.features) {
      expect(f.properties.usageCode).toBeNull();
    }
  });

  it("zone = null quand pas de zoneVersionProvider (zones absentes → score 0)", async () => {
    const app = geoLotsRoute({ fetchImpl: makeOkFetch() });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: {
        features: {
          properties: { zone: unknown; potentialScore: number };
        }[];
      };
    };

    for (const f of body.featureCollection.features) {
      expect(f.properties.zone).toBeNull();
      expect(f.properties.potentialScore).toBe(0);
    }
  });

  it("zone = null quand provider retourne null (zones absentes → score 0)", async () => {
    const provider: ZoneVersionProvider = () => null;
    const app = geoLotsRoute({ fetchImpl: makeOkFetch(), zoneVersionProvider: provider });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: {
        features: {
          properties: { zone: unknown; potentialScore: number };
        }[];
      };
    };

    for (const f of body.featureCollection.features) {
      expect(f.properties.zone).toBeNull();
      expect(f.properties.potentialScore).toBe(0);
    }
  });

  it("zone exposée quand provider réel retourne une ZoneVersionInput", async () => {
    const provider: ZoneVersionProvider = (_noLot, _city): ZoneVersionInput => ({
      densiteLogHa: 80,
      usages: ["résidentiel", "multifamilial"],
      kind: "H",
    });
    const app = geoLotsRoute({ fetchImpl: makeOkFetch(), zoneVersionProvider: provider });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: {
        features: {
          properties: {
            zone: { kind: string; usages: string[]; densiteLogHa: number | null } | null;
            potentialScore: number;
          };
        }[];
      };
    };

    expect(res.status).toBe(200);
    for (const f of body.featureCollection.features) {
      expect(f.properties.zone).not.toBeNull();
      expect(f.properties.zone?.kind).toBe("H");
      expect(f.properties.zone?.densiteLogHa).toBe(80);
      expect(f.properties.zone?.usages).toEqual(["résidentiel", "multifamilial"]);
      // scoreBase(80)=3 + bonusKind(H)=1 = 4.0
      expect(f.properties.potentialScore).toBe(4.0);
    }
  });

  it("zone provider per-lot : chaque lot a sa zone et son score réel", async () => {
    const provider: ZoneVersionProvider = (noLot): ZoneVersionInput | null => {
      if (noLot === "4193751") return { densiteLogHa: 50, usages: ["commercial"], kind: "C" };
      if (noLot === "4193752") return { densiteLogHa: 150, usages: ["résidentiel"], kind: "H" };
      return null;
    };
    const app = geoLotsRoute({ fetchImpl: makeOkFetch(), zoneVersionProvider: provider });
    const res = await app.request("/api/geo/salaberry-de-valleyfield/lots");
    const body = (await res.json()) as {
      featureCollection: {
        features: {
          properties: {
            noLot: string;
            zone: { kind: string; densiteLogHa: number | null } | null;
            potentialScore: number;
          };
        }[];
      };
    };

    const f1 = body.featureCollection.features.find(
      (f) => f.properties.noLot === "4193751",
    );
    const f2 = body.featureCollection.features.find(
      (f) => f.properties.noLot === "4193752",
    );

    expect(f1?.properties.zone?.kind).toBe("C");
    expect(f1?.properties.zone?.densiteLogHa).toBe(50);
    // scoreBase(50)=2 + bonusReconvertible(C)=0.5 = 2.5
    expect(f1?.properties.potentialScore).toBe(2.5);

    expect(f2?.properties.zone?.kind).toBe("H");
    expect(f2?.properties.zone?.densiteLogHa).toBe(150);
    // scoreBase(150)=4 + bonusKind(H)=1 = 5.0
    expect(f2?.properties.potentialScore).toBe(5.0);
  });
});
