/**
 * cptaq-client — test unitaire (mock `fetch`). Miroir de `zones-client.test.ts` :
 * id de collection per-ville, URL OGC directe (base `VITE_GEO_OGC_BASE_URL`),
 * params bbox/limit, et robustesse fetch : 200 normalisé, 404 → absence (sans
 * lever), non-404 → lève.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cptaqCollectionId,
  resolveCptaqUrl,
  fetchCptaqConstraints,
} from "./cptaq-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("cptaqCollectionId", () => {
  it("maps a city slug to the CPTAQ constraints collection id", () => {
    expect(cptaqCollectionId("sutton")).toBe("ca-qc-constraints-sutton");
    expect(cptaqCollectionId("saint-stanislas-de-kostka")).toBe(
      "ca-qc-constraints-saint-stanislas-de-kostka",
    );
  });
});

describe("resolveCptaqUrl", () => {
  it("routes to the same-origin /api/geo/collections proxy when no baseUrl", () => {
    // VITE_GEO_OGC_BASE_URL unset en préprod : le même-origine nu `/collections`
    // n'est pas proxifié (SPA fallback) → on DOIT passer par /api/geo/collections.
    expect(resolveCptaqUrl("warden", { baseUrl: "" })).toBe(
      "/api/geo/collections/ca-qc-constraints-warden/items",
    );
  });

  it("prepends the geo OGC baseUrl, stripping the trailing slash", () => {
    expect(
      resolveCptaqUrl("warden", { baseUrl: "https://api.preprod.geo.sent-tech.ca/" }),
    ).toBe("https://api.preprod.geo.sent-tech.ca/collections/ca-qc-constraints-warden/items");
  });

  it("includes bbox + limit query params when provided", () => {
    const url = new URL(
      resolveCptaqUrl("coaticook", {
        baseUrl: "https://geo.example",
        bbox: [-72.2, 45.1, -71.9, 45.3],
        limit: 500,
      }),
    );
    expect(url.searchParams.get("bbox")).toBe("-72.2,45.1,-71.9,45.3");
    expect(url.searchParams.get("limit")).toBe("500");
  });
});

describe("fetchCptaqConstraints", () => {
  it("returns a normalized FeatureCollection on OGC HTTP 200 (opaque properties, null geometry kept)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          numberMatched: 2,
          numberReturned: 2,
          features: [
            {
              type: "Feature",
              geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
              properties: { Zonage: "A", Mrc: "Brome-Missisquoi" },
            },
            { type: "Feature", geometry: null, properties: {} },
          ],
        }),
        { status: 200 },
      ),
    );
    const res = await fetchCptaqConstraints("sutton", { baseUrl: "" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("geo-ogc");
    expect(res.collectionId).toBe("ca-qc-constraints-sutton");
    expect(res.featureCollection.features).toHaveLength(2);
    expect(res.featureCollection.features[0]!.geometry?.type).toBe("Polygon");
    expect(res.featureCollection.features[0]!.properties.Zonage).toBe("A");
    expect(res.featureCollection.features[1]!.geometry).toBeNull();
  });

  it("returns absent (ok=false, absent=true) on HTTP 404 without throwing", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: "collection_not_found" }), { status: 404 }),
    );
    const res = await fetchCptaqConstraints("laval", { baseUrl: "" });
    expect(res.ok).toBe(false);
    expect(res.absent).toBe(true);
    expect(res.source).toBe("none");
    expect(res.collectionId).toBe("ca-qc-constraints-laval");
    expect(res.featureCollection.features).toHaveLength(0);
  });

  it("throws on a non-404 HTTP error", async () => {
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    await expect(fetchCptaqConstraints("sutton", { baseUrl: "" })).rejects.toThrow(
      "cptaq HTTP 500",
    );
  });

  it("throws on an unexpected (non-FeatureCollection) 200 body", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
    );
    await expect(fetchCptaqConstraints("sutton", { baseUrl: "" })).rejects.toThrow(
      /réponse geo inattendue/,
    );
  });
});
