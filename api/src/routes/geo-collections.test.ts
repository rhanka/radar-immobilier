/**
 * Tests de GET /api/geo/collections/:id/items — priorité store local + fallback proxy.
 * fetchImpl et localResolver mockés — aucun appel réseau réel, aucun Postgres.
 */
import { describe, expect, it } from "vitest";
import {
  geoCollectionsRoute,
  parseCollectionId,
  type LocalCollectionResolver,
} from "./geo-collections.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────
const LOCAL_FC = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      geometry: { type: "Point", coordinates: [-73.6, 45.6] },
      properties: { featureKind: "zone", zoneCode: "H-101", citySlug: "delson" },
    },
  ],
};

const GEO_OGC_FC = {
  type: "FeatureCollection",
  numberMatched: 2,
  numberReturned: 2,
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.8, 45.65] },
      properties: { ZONE: "C-18" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.81, 45.66] },
      properties: { ZONE: "H-431" },
    },
  ],
};

function makeOkFetch(body: unknown = GEO_OGC_FC): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function makeFailFetch(status: number): typeof fetch {
  return (async () => new Response(null, { status })) as unknown as typeof fetch;
}

function makeThrowFetch(): typeof fetch {
  return (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
}

const emptyLocal: LocalCollectionResolver = async () => null;

// ─── parseCollectionId ─────────────────────────────────────────────────────
describe("parseCollectionId", () => {
  it("parse qc-zonage-<city> et qc-lots-<city>", () => {
    expect(parseCollectionId("qc-zonage-rosemere")).toEqual({
      collectionId: "qc-zonage-rosemere",
      kind: "zonage",
      citySlug: "rosemere",
    });
    expect(parseCollectionId("qc-lots-delson")).toEqual({
      collectionId: "qc-lots-delson",
      kind: "lots",
      citySlug: "delson",
    });
  });

  it("rejette les collections hors préfixe (anti-SSRF)", () => {
    expect(parseCollectionId("foo-bar")).toBeNull();
    expect(parseCollectionId("qc-zonage-")).toBeNull();
  });
});

// ─── Store local prioritaire ─────────────────────────────────────────────────
describe("store local prioritaire", () => {
  it("sert les features locales et n'appelle PAS le proxy", async () => {
    const { fn, calls } = makeOkFetch();
    const localResolver: LocalCollectionResolver = async () => LOCAL_FC;
    const app = geoCollectionsRoute({ localResolver, fetchImpl: fn });

    const res = await app.request("/api/geo/collections/qc-zonage-delson/items?limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      features: unknown[];
      numberReturned: number;
    };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(body.numberReturned).toBe(1);
    expect(calls).toHaveLength(0); // aucun proxy
  });
});

// ─── Fallback proxy ──────────────────────────────────────────────────────────
describe("fallback proxy geo (collection absente du store local)", () => {
  it("proxifie vers l'API geo et renvoie la FeatureCollection OGC telle quelle", async () => {
    const { fn, calls } = makeOkFetch();
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });

    const res = await app.request(
      "/api/geo/collections/qc-zonage-rosemere/items?limit=1&bbox=-74,45,-73,46",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; features: unknown[] };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(2);

    expect(calls).toHaveLength(1);
    const url = calls[0]!;
    expect(url).toContain("https://geo.example/collections/qc-zonage-rosemere/items");
    expect(url).toContain("limit=1");
    expect(url).toContain("bbox=-74%2C45%2C-73%2C46");
    expect(url).toContain("f=json");
  });

  it("proxifie aussi qc-lots-*", async () => {
    const { fn, calls } = makeOkFetch();
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });
    const res = await app.request("/api/geo/collections/qc-lots-rosemere/items");
    expect(res.status).toBe(200);
    expect(calls[0]).toContain("/collections/qc-lots-rosemere/items");
  });
});

// ─── Erreurs ─────────────────────────────────────────────────────────────────
describe("erreurs", () => {
  it("erreur réseau geo → 502 honnête (pas de crash)", async () => {
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: makeThrowFetch(),
    });
    const res = await app.request("/api/geo/collections/qc-zonage-rosemere/items");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("geo_proxy_unreachable");
  });

  it("geo répond 5xx → 502 honnête", async () => {
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: makeFailFetch(503),
    });
    const res = await app.request("/api/geo/collections/qc-zonage-rosemere/items");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("geo_proxy_error");
  });

  it("geo répond 404 → 404 honnête (collection réellement absente)", async () => {
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: makeFailFetch(404),
    });
    const res = await app.request("/api/geo/collections/qc-zonage-inconnue/items");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("collection_not_found");
  });

  it("collection hors préfixe → 404 sans proxy", async () => {
    const { fn, calls } = makeOkFetch();
    const app = geoCollectionsRoute({ localResolver: emptyLocal, fetchImpl: fn });
    const res = await app.request("/api/geo/collections/random-collection/items");
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

// ─── Robustesse store local ──────────────────────────────────────────────────
describe("store local indisponible", () => {
  it("si le resolver local jette (PG down), on proxifie sans crasher", async () => {
    const { fn, calls } = makeOkFetch();
    const throwingLocal: LocalCollectionResolver = async () => {
      throw new Error("PG unavailable");
    };
    const app = geoCollectionsRoute({
      localResolver: throwingLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });
    const res = await app.request("/api/geo/collections/qc-lots-delson/items");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});
