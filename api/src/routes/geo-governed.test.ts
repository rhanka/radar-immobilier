/**
 * Route tests for the governed geo facade (I-1A, converged r3 §2).
 * fetchImpl is fully mocked — no real network, no Postgres.
 */
import { describe, expect, it } from "vitest";
import {
  GOVERNANCE_PROVENANCE_FALLBACK,
  GOVERNANCE_PROVENANCE_HEADER,
  GOVERNANCE_PROVENANCE_LIVE,
  GOVERNED_BASE_PATH,
  geoGovernedRoute,
} from "./geo-governed.js";
import { createApp } from "../app.js";
import type { AuthConfig } from "../config.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";

const CC_BY_4 = "Creative Commons Attribution 4.0 International";
const PILOT = "qc-zonage-gatineau-affectations-territoire";

const LISTING = {
  collections: [
    {
      id: PILOT,
      license: { title: CC_BY_4, href: "https://creativecommons.org/licenses/by/4.0/" },
      rights: { profile: "open", licenseStatus: "explicit" },
    },
    {
      id: "qc-zonage-salaberry-de-valleyfield",
      license: { title: "Unknown license" },
    },
    {
      id: "qc-zonage-laval-sad-centre-ville",
      license: { title: CC_BY_4 },
      rights: { profile: "open", licenseStatus: "explicit" },
    },
    { id: "qc-lots-delson", license: { title: "Unknown license" } },
    { id: "qc-zoning-events-candiac", license: { title: "Unknown license" } },
  ],
};

const LIVE_ITEMS = {
  type: "FeatureCollection",
  numberMatched: 1,
  numberReturned: 1,
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-75.7, 45.45] },
      properties: {
        DESCRIPTION: "Affectation résidentielle",
        name: "Zone R-1",
        MUNID: "81017",
        adresse: "123 rue Principale",
        code_postal: "J8X 1A1",
        code_postal_precision: "exact",
        extrait_brut: "M. Tremblay demande une dérogation…",
        unknown_future_field: "dropped",
      },
    },
  ],
};

/** Mock fetch routing listing vs items URLs; counts every upstream call. */
function makeFetch(options?: { itemsStatus?: number }): {
  fn: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/collections?")) {
      return new Response(JSON.stringify(LISTING), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(LIVE_ITEMS), {
      status: options?.itemsStatus ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("frozen governed path (P3)", () => {
  it("the governed root is frozen and distinct from the public prefix", () => {
    expect(GOVERNED_BASE_PATH).toBe("/api/v1/geo-governed");
    expect(GOVERNED_BASE_PATH.startsWith("/api/geo/")).toBe(false);
  });
});

describe("GET catalog", () => {
  it("lists the pilot as served and everything else with a status", async () => {
    const { fn } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    const res = await app.request(`${GOVERNED_BASE_PATH}/catalog`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      pilotCity: string;
      served: Array<{ collectionId: string; status: string }>;
      refused: Array<{ collectionId: string; status: string; reason?: string }>;
      contract: { status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.pilotCity).toBe("gatineau");
    expect(body.served.map((e) => e.collectionId)).toEqual([PILOT]);
    expect(body.refused).toHaveLength(4);
    expect(
      body.refused.find((e) => e.collectionId === "qc-zonage-salaberry-de-valleyfield"),
    ).toMatchObject({ status: "unknown" });
    expect(
      body.refused.find((e) => e.collectionId === "qc-lots-delson"),
    ).toMatchObject({ status: "not served" });
    expect(
      body.refused.find((e) => e.collectionId === "qc-zoning-events-candiac"),
    ).toMatchObject({ status: "not served" });
    expect(
      body.refused.find((e) => e.collectionId === "qc-zonage-laval-sad-centre-ville"),
    ).toMatchObject({ status: "not covered" });
    // P1: no credential exists ⇒ explicit missing source, never fabricated.
    expect(body.contract.status).toBe("missing source");
  });

  it("is honest when the live listing is unreachable", async () => {
    const app = geoGovernedRoute({
      fetchImpl: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
      baseUrl: "https://geo.example",
    });
    const res = await app.request(`${GOVERNED_BASE_PATH}/catalog`);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe(
      "geo_governed_listing_unreachable",
    );
  });
});

describe("GET items refusals (zero upstream calls)", () => {
  it.each([
    ["qc-lots-delson", "not served"],
    ["qc-zoning-events-candiac", "not served"],
    // No dated per-collection record: the catalogue status (`not covered`)
    // is served BEFORE any upstream call — the live licence is unverifiable
    // without one, and the record is missing in every case.
    ["qc-zonage-salaberry-de-valleyfield", "not covered"],
    ["qc-zonage-unknown-city", "not covered"],
  ])("refuses %s (%s) without any upstream call", async (id, status) => {
    const { fn, calls } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    const res = await app.request(`${GOVERNED_BASE_PATH}/collections/${id}/items`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      status: string;
      reason?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("geo_governed_not_served");
    expect(body.status).toBe(status);
    expect(calls).toHaveLength(0); // refused BEFORE any upstream call
  });

  it("refuses an unregistered licence-known zonage as not covered (same as catalog)", async () => {
    const { fn, calls } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    const res = await app.request(
      `${GOVERNED_BASE_PATH}/collections/qc-zonage-laval-sad-centre-ville/items`,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "geo_governed_not_served",
      status: "not covered",
      reason: "no-dated-per-collection-record",
    });
    expect(calls).toHaveLength(0); // refused BEFORE any upstream call
  });

  it("refuses an off-catalogue id as a typed 403 without any upstream call", async () => {
    const { fn, calls } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    const res = await app.request(`${GOVERNED_BASE_PATH}/collections/random-collection/items`);
    // Uniform refusal: every non-served id is a typed 403, never a 200-empty.
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; status: string; reason: string };
    expect(body.error).toBe("geo_governed_not_served");
    expect(body.status).toBe("not served");
    expect(body.reason).toBe("family-other-deferred-in-i1a");
    expect(calls).toHaveLength(0);
  });

  it("never serves a 200-empty body on refusal", async () => {
    const { fn } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    const res = await app.request(`${GOVERNED_BASE_PATH}/collections/qc-lots-delson/items`);
    expect(res.status).not.toBe(200);
  });

  it("serves no PMTiles route or reference (N2 negative)", async () => {
    const { fn } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    for (const path of [
      `${GOVERNED_BASE_PATH}/pmtiles/qc-zones.pmtiles`,
      `${GOVERNED_BASE_PATH}/collections/${PILOT}/pmtiles`,
    ]) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
    }
  });
});

describe("GET items served (bounded proxy, allowlist, provenance)", () => {
  it("proxies the pilot live with x-geo-provenance live-ogc and the allowlist applied", async () => {
    const { fn } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    const res = await app.request(`${GOVERNED_BASE_PATH}/collections/${PILOT}/items?limit=10`);
    expect(res.status).toBe(200);
    expect(res.headers.get(GOVERNANCE_PROVENANCE_HEADER)).toBe(GOVERNANCE_PROVENANCE_LIVE);
    const body = (await res.json()) as {
      type: string;
      features: Array<{ properties: Record<string, unknown> }>;
      collectionId: string;
      licenseId: string;
      contract: { status: string };
    };
    expect(body.collectionId).toBe(PILOT);
    expect(body.licenseId).toBe("cc-by-4.0");
    expect(body.contract.status).toBe("missing source");
    const props = body.features[0]!.properties;
    expect(props["DESCRIPTION"]).toBe("Affectation résidentielle");
    expect(props["MUNID"]).toBe("81017");
    // Banned and unrecorded keys are gone (O3 default).
    for (const banned of [
      "adresse",
      "code_postal",
      "code_postal_precision",
      "extrait_brut",
      "unknown_future_field",
    ]) {
      expect(props).not.toHaveProperty(banned);
    }
    expect(JSON.stringify(body)).not.toContain("rue Principale");
  });

  it("preserves a contract-valid proof envelope on the live path (composition order)", async () => {
    // Regression: the allowlist drops PROVENANCE_KEYS, so nesting the
    // provenance sanitiser INSIDE applyZonageAllowlist silently deleted
    // `proof`. The route allowlists first, then re-attaches validated
    // envelopes — a valid proof survives, an invalid one does not.
    const validProof = {
      schema_version: "2.0",
      geometry_source: {
        url: "https://example.com/geo/gatineau.json",
        type: "geonet",
        method: "natif",
        reliability: "directe",
        retrieved_at: null,
        sha256: null,
      },
    };
    const calls: string[] = [];
    const fn = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/collections?")) {
        return new Response(JSON.stringify(LISTING), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          type: "FeatureCollection",
          numberMatched: 2,
          numberReturned: 2,
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-75.7, 45.45] },
              properties: {
                DESCRIPTION: "kept",
                adresse: "123 rue Principale",
                proof: validProof,
              },
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-75.71, 45.46] },
              properties: {
                DESCRIPTION: "kept-too",
                proof: { schema_version: "2.0", geometry_source: { url: "not-a-url" } },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    const res = await app.request(`${GOVERNED_BASE_PATH}/collections/${PILOT}/items?limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    const kept = body.features[0]!.properties;
    expect(kept["DESCRIPTION"]).toBe("kept");
    expect(kept["proof"]).toEqual(validProof);
    expect(kept).not.toHaveProperty("adresse");
    // An invalid envelope is dropped as a whole, never partly rewritten.
    const dropped = body.features[1]!.properties;
    expect(dropped["DESCRIPTION"]).toBe("kept-too");
    expect(dropped).not.toHaveProperty("proof");
  });

  it("bounds the limit (max 1000) on the upstream query", async () => {
    const { fn, calls } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    await app.request(`${GOVERNED_BASE_PATH}/collections/${PILOT}/items?limit=99999`);
    const itemsCall = calls.find((u) => u.includes("/items?"));
    expect(itemsCall).toContain("limit=1000");
    expect(itemsCall).toContain("f=json");
  });

  it("falls back to pg with x-geo-provenance pg-fallback when live fails", async () => {
    const { fn } = makeFetch({ itemsStatus: 503 });
    const localZoneResolver = async () => ({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-75.7, 45.45] },
          properties: {
            DESCRIPTION: "Affectation résidentielle",
            name: "Zone R-1",
            zoneCode: "R-1",
            citySlug: "gatineau",
            adresse: "123 rue Principale",
            code_postal: "J8X 1A1",
            extrait_brut: "M. Tremblay demande une dérogation…",
          },
        },
      ],
    });
    const app = geoGovernedRoute({
      fetchImpl: fn,
      baseUrl: "https://geo.example",
      localZoneResolver,
    });
    const res = await app.request(`${GOVERNED_BASE_PATH}/collections/${PILOT}/items`);
    expect(res.status).toBe(200);
    expect(res.headers.get(GOVERNANCE_PROVENANCE_HEADER)).toBe(GOVERNANCE_PROVENANCE_FALLBACK);
    const body = (await res.json()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    const props = body.features[0]!.properties;
    // pg-fallback serves through the SAME allowlist as the live path.
    expect(props["DESCRIPTION"]).toBe("Affectation résidentielle");
    expect(props["name"]).toBe("Zone R-1");
    for (const banned of ["adresse", "code_postal", "extrait_brut", "zoneCode", "citySlug"]) {
      expect(props).not.toHaveProperty(banned);
    }
    expect(JSON.stringify(body)).not.toContain("rue Principale");
    expect(JSON.stringify(body)).not.toContain("Tremblay");
  });

  it("answers 502 honest when live fails and no local store is stocked", async () => {
    const { fn } = makeFetch({ itemsStatus: 503 });
    const app = geoGovernedRoute({
      fetchImpl: fn,
      baseUrl: "https://geo.example",
      localZoneResolver: async () => null,
    });
    const res = await app.request(`${GOVERNED_BASE_PATH}/collections/${PILOT}/items`);
    expect(res.status).toBe(502);
  });
});

describe("createApp wiring (auth gating + AppDeps seams)", () => {
  const AUTH_ON: AuthConfig = {
    enabled: true,
    issuer: "https://auth.example.test",
    clientId: "radar-immobilier",
    clientSecret: "super-secret",
    redirectUri: "https://immo.example.test/api/v1/auth/oauth/callback",
    scopes: "openid profile email",
    appBaseUrl: "https://immo.example.test",
    sessionSecret: "session-secret-32-bytes-long-padding!!",
    sessionTtlSeconds: 3600,
    sessionAbsoluteTtlSeconds: 7200,
    jwksUri: "https://auth.example.test/.well-known/jwks.json",
    bearerAudiences: ["https://immo.example.test", "https://immo.example.test/mcp"],
  };

  it("serves the governed catalog through the createApp seams when auth is off", async () => {
    // Proves AppDeps propagation: without fetchImpl/geoBaseUrl reaching
    // geoGovernedRoute, this would hit the real OGC base URL and fail.
    const { fn } = makeFetch();
    const app = createApp({
      checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }),
      fetchImpl: fn,
      geoBaseUrl: "https://geo.example",
      db: undefined as unknown as Database,
      store: {} as unknown as ObjectStore,
    });
    const res = await app.request(`${GOVERNED_BASE_PATH}/catalog`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      served: Array<{ collectionId: string }>;
    };
    expect(body.served.map((e) => e.collectionId)).toEqual([PILOT]);
  });

  it("session-gates the governed catalog (401) with zero upstream calls", async () => {
    const { fn, calls } = makeFetch();
    const app = createApp({
      checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }),
      auth: AUTH_ON,
      fetchImpl: fn,
      geoBaseUrl: "https://geo.example",
      db: undefined as unknown as Database,
      store: {} as unknown as ObjectStore,
    });
    const res = await app.request(`${GOVERNED_BASE_PATH}/catalog`);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0); // gated by protect, before any fetch
  });

  it("leaves /api/geo/collections/* public while the governed root needs a session", async () => {
    // The public prefix must stay reachable without a session; point the
    // server-side OGC fallback at an unroutable test address so the public
    // request fails fast offline (502) instead of touching the network.
    const previous = process.env["GEO_OGC_BASE_URL"];
    process.env["GEO_OGC_BASE_URL"] = "http://127.0.0.1:9";
    try {
      const { fn } = makeFetch();
      const app = createApp({
        checkDb: async () => ({ ok: true }),
        checkObjectStore: async () => ({ ok: true }),
        auth: AUTH_ON,
        fetchImpl: fn,
        geoBaseUrl: "https://geo.example",
        db: undefined as unknown as Database,
        store: {} as unknown as ObjectStore,
      });
      const pub = await app.request("/api/geo/collections/qc-lots-delson/items?limit=1");
      // Never session-gated: any non-401 proves protect let it through.
      expect(pub.status).not.toBe(401);
      const gov = await app.request(`${GOVERNED_BASE_PATH}/catalog`);
      expect(gov.status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env["GEO_OGC_BASE_URL"];
      else process.env["GEO_OGC_BASE_URL"] = previous;
    }
  });
});
