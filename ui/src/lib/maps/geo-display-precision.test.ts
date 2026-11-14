import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllLots, fetchExactLot, resolveLotsUrl } from "./lots-client.js";
import { resolveZonesUrl } from "./zones-client.js";
import { loadSignauxZones } from "./signaux-zones-loader.js";
import { centroid, estimatedFacadeM } from "$lib/components/maps/lot-fiche-utils.js";

afterEach(() => vi.unstubAllGlobals());
const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-73,45],[-72,45],[-72,46],[-73,45]]] }, properties: { noLot: "123", citySlug: "rawdon" } };

describe("display precision boundary", () => {
  it("should keep exact requests as the default", () => {
    expect(resolveLotsUrl("rawdon")).not.toContain("coordPrecision");
    expect(resolveZonesUrl("rawdon")).not.toContain("coordPrecision");
    expect(resolveLotsUrl("rawdon", { displayOnly: true })).toContain("coordPrecision=6");
  });
  it("should opt in for the city zoning display loader only", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, citySlug: "rawdon", source: "official", featureCollection: { type: "FeatureCollection", features: [] } }));
    await loadSignauxZones("rawdon", { fetchZonesCollection: fetcher as never, fetchResolvedZones: vi.fn(async () => null) as never });
    expect(fetcher).toHaveBeenCalledWith("rawdon", expect.objectContaining({ displayOnly: true }));
  });
  it("should ignore upstream next URLs and paginate on the relative same-origin path", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ type: "FeatureCollection", features: [feature], numberMatched: 2, links: [{ rel: "next", href: "http://other.example/collections/lots/items?offset=1" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "FeatureCollection", features: [{ ...feature, properties: { noLot: "456" } }], numberMatched: 2 })));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchAllLots("rawdon", { baseUrl: "", displayOnly: true, pageLimit: 2 });
    expect(result.featureCollection.features).toHaveLength(2);
    for (const [url] of fetcher.mock.calls) {
      expect(url).toMatch(/^\/api\/geo\/collections\/qc-lots-rawdon\/items\?/);
      expect(url).toContain("coordPrecision=6");
    }
    expect(fetcher.mock.calls[1][0]).toContain("offset=1");
    expect(estimatedFacadeM(result.featureCollection.features[0]!)).toBeNull();
    expect(centroid(result.featureCollection.features[0]!)).toBeNull();
  });
  it("should fetch exact detail without precision even after a reduced map load", async () => {
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify(feature)));
    vi.stubGlobal("fetch", fetcher);
    const exact = await fetchExactLot("rawdon", "123", "ca/qc/lot/123");
    expect(fetcher.mock.calls[0][0]).toBe("/api/geo/collections/qc-lots-rawdon/items/ca%2Fqc%2Flot%2F123");
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
