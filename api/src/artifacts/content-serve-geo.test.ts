/**
 * I-1B dispatch tests through the real content host (converged-geo-mesh r3
 * §2). New file on purpose: no existing content-serve test is edited, so the
 * I2-partage rebase keeps this hunk separate.
 */
import { describe, expect, it, vi } from "vitest";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { createReaderContentApp } from "./content-serve.js";
import { createGeoReadOperation, type ReaderGeoDeps } from "./reader-geo.js";
import {
  GRANT_SECRET,
  HOST,
  ISSUER,
  SESSION_SECRET,
  credentials,
  fixtureReaderDeps,
  request,
} from "./reader-test-fixture.js";

const FINGERPRINT = fingerprintReaderProfile({
  name: "demo",
  policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"],
});

const CC_BY_4 = "Creative Commons Attribution 4.0 International";
const PILOT = "qc-zonage-gatineau-affectations-territoire";

const LISTING = {
  collections: [
    {
      id: PILOT,
      license: { title: CC_BY_4 },
      rights: { profile: "open", licenseStatus: "explicit" },
    },
    { id: "qc-zonage-salaberry-de-valleyfield", license: { title: "Unknown license" } },
    { id: "qc-lots-delson", license: { title: "Unknown license" } },
  ],
};

const GATINEAU_ITEMS = {
  type: "FeatureCollection",
  numberMatched: 2,
  numberReturned: 2,
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-75.7, 45.45],
            [-75.69, 45.45],
            [-75.69, 45.46],
            [-75.7, 45.46],
            [-75.7, 45.45],
          ],
        ],
      },
      properties: {
        ABREVIATION: "R-1",
        DESCRIPTION: "Affectation résidentielle",
        MUNID: "81017",
        TYPE: "Résidentiel",
        name: "Zone R-1",
        geoId: "gatineau-r-1",
        adresse: "123 rue Principale",
        code_postal: "J8X 1A1",
        extrait_brut: "M. Tremblay demande une dérogation…",
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-75.71, 45.44],
            [-75.7, 45.44],
            [-75.7, 45.45],
            [-75.71, 45.45],
            [-75.71, 45.44],
          ],
        ],
      },
      properties: {
        ABREVIATION: "C-2",
        DESCRIPTION: "Affectation commerciale",
        MUNID: "81017",
        TYPE: "Commercial",
        name: "Zone C-2",
        geoId: "gatineau-c-2",
      },
    },
  ],
};

function stubGeoFetch() {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/collections?")) {
      return new Response(JSON.stringify(LISTING), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(GATINEAU_ITEMS), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function geoDeps(fetchImpl: typeof fetch): ReaderGeoDeps {
  return {
    fetchImpl,
    baseUrl: "https://geo.example",
    contractEnv: {},
    listCitiesImpl: async () => [
      { citySlug: "gatineau", zoneCount: 177, lotCount: 0, signalCount: 0 },
      { citySlug: "salaberry-de-valleyfield", zoneCount: 42, lotCount: 0, signalCount: 0 },
    ],
  };
}

function makeGeoApp(fetchImpl: typeof fetch) {
  const fixture = fixtureReaderDeps();
  return createReaderContentApp({
    ...fixture,
    readOperation: createGeoReadOperation(geoDeps(fetchImpl)) as NonNullable<
      Parameters<typeof createReaderContentApp>[0]["readOperation"]
    >,
    contentBase: "pages.example.test",
    grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET,
    issuer: ISSUER,
    now: () => 1_000,
  });
}

async function aliceGrant(sessionId = "session-1", atMs = 1_000): Promise<string> {
  return mintGrant(
    {
      ...ISSUER,
      host: HOST,
      artifactId: "123e4567-e89b-12d3-a456-426614174000",
      releaseId: "123e4567-e89b-12d3-a456-426614174001",
      readerSub: "reader-alice",
      sessionId,
      profileName: "demo",
      policyRevision: "pol-001",
      profileFingerprint: FINGERPRINT,
    },
    GRANT_SECRET,
    atMs,
  );
}

describe("I-1B geo dispatch on the content host", () => {
  it("serves real Gatineau zones to an approved reader", async () => {
    const { fetchImpl, calls } = stubGeoFetch();
    const app = makeGeoApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();

    const cities = await request(app, "/__reader/api/geo.cities.v1", cookie, grant);
    expect(cities.status).toBe(200);
    const citiesBody = (await cities.json()) as { ok: boolean; cities: { citySlug: string; collections: string[] }[] };
    expect(citiesBody.ok).toBe(true);
    expect(citiesBody.cities.map((city) => city.citySlug)).toEqual(["gatineau"]);
    expect(citiesBody.cities[0]?.collections).toEqual([PILOT]);

    const items = await request(
      app,
      `/__reader/api/geo.collection-items.v1?collectionId=${PILOT}&limit=10`,
      cookie,
      grant,
    );
    expect(items.status).toBe(200);
    const body = (await items.json()) as {
      type: string;
      features: { geometry: { type: string }; properties: Record<string, unknown> }[];
      numberMatched: number;
      numberReturned: number;
      truncated: boolean;
      collectionId: string;
      licenseId: string;
    };
    expect(body.type).toBe("FeatureCollection");
    expect(body.numberMatched).toBe(2);
    expect(body.numberReturned).toBe(2);
    expect(body.truncated).toBe(false);
    expect(body.collectionId).toBe(PILOT);
    expect(body.licenseId).toBe("cc-by-4.0");
    expect(body.features[0]?.geometry.type).toBe("Polygon");
    expect(body.features[0]?.properties["DESCRIPTION"]).toBe("Affectation résidentielle");
    for (const banned of ["adresse", "code_postal", "extrait_brut"]) {
      expect(body.features[0]?.properties).not.toHaveProperty(banned);
    }
    expect(JSON.stringify(body)).not.toContain("rue Principale");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("refuses a listed-not-served collection typed with no upstream call", async () => {
    const { fetchImpl, calls } = stubGeoFetch();
    const app = makeGeoApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();
    const res = await request(
      app,
      "/__reader/api/geo.collection-items.v1?collectionId=qc-lots-delson&limit=10",
      cookie,
      grant,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "geo_governed_not_served",
      collectionId: "qc-lots-delson",
      status: "not served",
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses a high limit without bbox with no upstream call", async () => {
    const { fetchImpl, calls } = stubGeoFetch();
    const app = makeGeoApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();
    const res = await request(
      app,
      `/__reader/api/geo.collection-items.v1?collectionId=${PILOT}&limit=500`,
      cookie,
      grant,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "geo_bbox_required" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a non-approved reader without any upstream call", async () => {
    const { fetchImpl, calls } = stubGeoFetch();
    const app = makeGeoApp(fetchImpl);
    const cookie = await credentials("reader-mallory", "session-m", 1_000);
    const grant = await mintGrant(
      {
        ...ISSUER,
        host: HOST,
        artifactId: "123e4567-e89b-12d3-a456-426614174000",
        releaseId: "123e4567-e89b-12d3-a456-426614174001",
        readerSub: "reader-mallory",
        sessionId: "session-m",
        profileName: "demo",
        policyRevision: "pol-001",
        profileFingerprint: FINGERPRINT,
      },
      GRANT_SECRET,
      1_000,
    );
    for (const path of [
      "/__reader/api/geo.cities.v1",
      `/__reader/api/geo.collection-items.v1?collectionId=${PILOT}&limit=10`,
    ]) {
      expect((await request(app, path, cookie, grant)).status, path).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses without the geo.read capability and never calls upstream", async () => {
    const { fetchImpl, calls } = stubGeoFetch();
    const fixture = fixtureReaderDeps();
    const upstream = vi.fn(createGeoReadOperation(geoDeps(fetchImpl)));
    const authority = {
      ...fixture.authority!,
      getRights: async (readerSub: string, artifactId: string) => ({
        readerSub,
        artifactId,
        approved: true,
        capabilities: ["signals.protected-read" as const],
      }),
    };
    const app = createReaderContentApp({
      ...fixture,
      authority,
      readOperation: upstream as NonNullable<Parameters<typeof createReaderContentApp>[0]["readOperation"]>,
      contentBase: "pages.example.test",
      grantSecret: GRANT_SECRET,
      sessionSecret: SESSION_SECRET,
      issuer: ISSUER,
      now: () => 1_000,
    });
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();
    expect((await request(app, "/__reader/api/geo.cities.v1", cookie, grant)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects invalid params without calling upstream", async () => {
    const { fetchImpl, calls } = stubGeoFetch();
    const app = makeGeoApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();
    const res = await request(app, "/__reader/api/geo.collection-items.v1?limit=10", cookie, grant);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_params" });
    expect(calls).toHaveLength(0);
  });
});
