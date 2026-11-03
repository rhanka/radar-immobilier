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
    ["qc-zonage-salaberry-de-valleyfield", "unknown"],
    ["qc-zonage-unknown-city", "unknown"],
  ])("refuses %s (%s) without any upstream call", async (id, status) => {
    const { fn, calls } = makeFetch();
    const app = geoGovernedRoute({ fetchImpl: fn, baseUrl: "https://geo.example" });
    const res = await app.request(`${GOVERNED_BASE_PATH}/collections/${id}/items`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      status: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("geo_governed_not_served");
    expect(body.status).toBe(status);
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
          properties: { zoneCode: "R-1", citySlug: "gatineau" },
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
