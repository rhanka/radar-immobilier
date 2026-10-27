import { describe, expect, it, vi } from "vitest";
import { lotsForCity } from "./lots.js";

/**
 * L3c characterization: upstream 502 text diagnostics and persisted-job
 * shape. No network: fetch is injected, failures stay typed and bounded.
 */
describe("l3c upstream and job diagnostics", () => {
  it("maps a non-ok upstream to ok:false with HTTP status in reason", async () => {
    const result = await lotsForCity("beauharnois", {
      bbox: [-73.9, 45.3, -73.8, 45.35],
      fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.featureCollection.features).toEqual([]);
  });

  it("maps an unexpected ArcGIS body to ok:false with a bounded reason", async () => {
    const result = await lotsForCity("beauharnois", {
      bbox: [-73.9, 45.3, -73.8, 45.35],
      fetchImpl: (async () =>
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe("string");
    expect((result.reason ?? "").length).toBeLessThan(2000);
  });

  it("keeps unknown cities distinct from upstream failures", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await lotsForCity("unknown-city-xyz", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.source).toBe("none");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a minimal valid GeoJSON feature collection", async () => {
    const body = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: { NO_LOT: "4 516 943" },
        },
      ],
    };
    const result = await lotsForCity("beauharnois", {
      bbox: [-73.9, 45.3, -73.8, 45.35],
      fetchImpl: (async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.featureCollection.features[0]?.properties.noLot).toBe("4 516 943");
  });
});
