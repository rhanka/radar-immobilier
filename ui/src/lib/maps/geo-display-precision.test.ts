import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllLots, fetchExactLot, resolveLotsUrl } from "./lots-client.js";
import { fetchZones, resolveZonesUrl } from "./zones-client.js";
import { loadSignauxZones } from "./signaux-zones-loader.js";
import { centroid, estimatedFacadeM } from "$lib/components/maps/lot-fiche-utils.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-73,45],[-72,45],[-72,46],[-73,45]]] }, properties: { noLot: "123", citySlug: "rawdon" } };

describe("display precision boundary", () => {
  it("should keep exact requests as the default", () => {
    expect(resolveLotsUrl("rawdon")).not.toContain("coordPrecision");
    expect(resolveZonesUrl("rawdon")).not.toContain("coordPrecision");
    expect(resolveLotsUrl("rawdon", { displayOnly: true, limit: 1, offset: 2, bbox: [0, 0, 1, 1] })).toBe("/api/geo/collections/qc-lots-rawdon/items?profile=display");
    expect(resolveZonesUrl("rawdon", { displayOnly: true, limit: 1, bbox: [0, 0, 1, 1] })).toBe("/api/geo/collections/qc-zonage-rawdon/items?profile=display");
  });
  it("should opt in for the city zoning display loader only", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, citySlug: "rawdon", source: "official", featureCollection: { type: "FeatureCollection", features: [] } }));
    await loadSignauxZones("rawdon", { fetchZonesCollection: fetcher as never, fetchResolvedZones: vi.fn(async () => null) as never });
    expect(fetcher).toHaveBeenCalledWith("rawdon", expect.objectContaining({ displayOnly: true }));
  });
  it("should load the whole display collection once without pagination or cache busting", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ type: "FeatureCollection", features: [feature, { ...feature, properties: { noLot: "456" } }], numberMatched: 2 }), { headers: { ETag: '"m1"', "Cache-Control": "no-cache", "X-Geo-Display-Version": "m1", "X-Geo-Display-Stale": "1" } }));
    vi.stubGlobal("fetch", fetcher);
    const onPage = vi.fn();
    const result = await fetchAllLots("rawdon", { baseUrl: "", displayOnly: true, pageLimit: 1, onPage });
    expect(result.featureCollection.features).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/geo/collections/qc-lots-rawdon/items?profile=display");
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("cache");
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(estimatedFacadeM(result.featureCollection.features[0]!)).toBeNull();
    expect(centroid(result.featureCollection.features[0]!)).toBeNull();
  });
  it.each([400, 404, 503])("should visibly fall back once on HTTP %s and paginate exact lots", async (status) => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"code":"DisplayUnavailable"}', { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "FeatureCollection", features: [feature], numberMatched: 2 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "FeatureCollection", features: [{ ...feature, properties: { noLot: "456" } }], numberMatched: 2 })));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchAllLots("rawdon", { displayOnly: true, pageLimit: 2 });
    expect(result.featureCollection.features).toHaveLength(2);
    expect(result.featureCollection.features.every((lot) => lot.displayOnly)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1][0]).toBe("/api/geo/collections/qc-lots-rawdon/items?limit=2&coordPrecision=6");
    expect(fetcher.mock.calls[2][0]).toContain("offset=1&coordPrecision=6");
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`HTTP ${status}; falling back`));
  });
  it.each([400, 404, 503])("should fall back once for zones on HTTP %s", async (status) => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "FeatureCollection", features: [{ ...feature, properties: { code: "H-1" } }] })));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchZones("rawdon", { displayOnly: true, limit: 3000 })).featureCollection.features).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("/api/geo/collections/qc-zonage-rawdon/items?limit=3000&coordPrecision=6");
    expect(log).toHaveBeenCalledOnce();
  });
  it.each([fetchAllLots, fetchZones])("should stop when the exact fallback is also unavailable", async (load) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(load("rawdon", { displayOnly: true })).rejects.toThrow("HTTP 503");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([fetchAllLots, fetchZones])("should propagate other HTTP errors without fallback", async (load) => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(load("rawdon", { displayOnly: true })).rejects.toThrow("HTTP 500");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("should fetch exact detail without precision even after a reduced map load", async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("profile=display") ? { type: "FeatureCollection", features: [feature] } : feature)));
    vi.stubGlobal("fetch", fetcher);
    await fetchAllLots("rawdon", { displayOnly: true });
    const exact = await fetchExactLot("rawdon", "123", "ca/qc/lot/123");
    expect(fetcher.mock.calls[1][0]).toBe("/api/geo/collections/qc-lots-rawdon/items/ca%2Fqc%2Flot%2F123");
    expect(exact.displayOnly).toBeUndefined();
    expect(exact.geometry).toEqual(feature.geometry);
    expect(estimatedFacadeM(exact)).not.toBeNull();
  });
  it("should retain the upstream identity needed by exact details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ type: "FeatureCollection", features: [{ ...feature, properties: { ...feature.properties, geoId: "ca/qc/lot/123" } }] }))));
    const lots = await fetchAllLots("rawdon", { displayOnly: true });
    expect(lots.featureCollection.features[0]?.id).toBe("ca/qc/lot/123");
  });
  it("should reject missing or mismatched exact details without returning display geometry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    await expect(fetchExactLot("rawdon", "123", "ca/qc/lot/123")).rejects.toThrow("HTTP 404");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...feature, properties: { noLot: "other" } }))));
    await expect(fetchExactLot("rawdon", "123", "ca/qc/lot/123")).rejects.toThrow("Unexpected exact lot response");
  });
});
