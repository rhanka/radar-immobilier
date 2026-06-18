import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";
import type { GeoZoneFeature, GeoZonesResponse } from "./geo-zones-client.js";
import type { LotFeatureCollection } from "./lots-client.js";
import {
  decorateLotsWithSignalProjection,
  fallbackZoneCode,
  opacityForSelectionKey,
  withCityFallbackZone,
} from "./signaux-map-geo.js";
import {
  DIMMED_SELECTION_OPACITY,
  FULL_SELECTION_OPACITY,
  createSelectionBucketState,
  makeKey,
} from "./selection-bucket.js";

const CITY_SLUG = "salaberry-de-valleyfield";

function polygon(): GeoJsonGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [-74.1, 45.25],
        [-74.09, 45.25],
        [-74.09, 45.26],
        [-74.1, 45.26],
        [-74.1, 45.25],
      ],
    ],
  };
}

function emptyZonesResponse(): GeoZonesResponse {
  return {
    ok: true,
    citySlug: CITY_SLUG,
    source: "none",
    resolutionStatus: "missing",
    geometryStatus: "missing",
    zoneCount: 0,
    warnings: [],
    featureCollection: { type: "FeatureCollection", features: [] },
  };
}

function zone(code: string, lots: string[]): GeoZoneFeature {
  return {
    type: "Feature",
    geometry: polygon(),
    properties: {
      code,
      citySlug: CITY_SLUG,
      geometryStatus: "official",
      confidence: 1,
      source: "official-zone",
      lotCount: lots.length,
      lots: lots.map((noLot) => ({ citySlug: CITY_SLUG, noLot })),
      label: `Zone ${code}`,
    },
  };
}

function lots(): LotFeatureCollection {
  return {
    type: "FeatureCollection",
    features: ["4 516 943", "4 516 944", "4 516 945"].map((noLot) => ({
      type: "Feature",
      geometry: polygon(),
      properties: { noLot, citySlug: CITY_SLUG },
    })),
  };
}

function signal(id: string, props: Record<string, unknown>): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: CITY_SLUG,
    sourceRef: null,
    createdAt: null,
    props,
  };
}

describe("withCityFallbackZone", () => {
  it("creates an explicit fallback:<citySlug> zone when the API has no zones", () => {
    const result = withCityFallbackZone(emptyZonesResponse(), {
      citySlug: CITY_SLUG,
      cityName: "Salaberry-de-Valleyfield",
      geometry: polygon(),
    });

    expect(result.created).toBe(true);
    expect(result.response.zoneCount).toBe(0);
    expect(result.response.resolutionStatus).toBe("fallback");
    expect(result.response.featureCollection.features[0].properties).toMatchObject({
      code: fallbackZoneCode(CITY_SLUG),
      geometryStatus: "missing",
      label: "Fallback ville - Salaberry-de-Valleyfield",
    });
  });

  it("keeps official zones unchanged", () => {
    const response: GeoZonesResponse = {
      ...emptyZonesResponse(),
      source: "official",
      resolutionStatus: "official",
      geometryStatus: "official",
      zoneCount: 1,
      featureCollection: { type: "FeatureCollection", features: [zone("H-609", [])] },
    };

    const result = withCityFallbackZone(response, {
      citySlug: CITY_SLUG,
      cityName: "Salaberry-de-Valleyfield",
      geometry: polygon(),
    });

    expect(result.created).toBe(false);
    expect(result.response).toBe(response);
  });
});

describe("opacityForSelectionKey", () => {
  it("uses the layer default while the selection bucket is empty", () => {
    const key = makeKey("zone", `${CITY_SLUG}/H-609`);

    expect(opacityForSelectionKey(createSelectionBucketState(), key, 0.42)).toBe(0.42);
  });

  it("keeps selected entities full color and unselected entities at 50 percent", () => {
    const selectedKey = makeKey("zone", `${CITY_SLUG}/H-609`);
    const otherKey = makeKey("lot", `${CITY_SLUG}/4 516 943`);
    const state = createSelectionBucketState({ selectedKeys: [selectedKey] });

    expect(opacityForSelectionKey(state, selectedKey, 0.42)).toBe(FULL_SELECTION_OPACITY);
    expect(opacityForSelectionKey(state, otherKey, 0.42)).toBe(DIMMED_SELECTION_OPACITY);
  });
});

describe("decorateLotsWithSignalProjection", () => {
  it("marks direct lot relations when a signal carries a structured lot ref", () => {
    const decorated = decorateLotsWithSignalProjection(
      lots(),
      [zone("H-609", ["4 516 943", "4 516 944"])],
      [signal("sig-1", { targets_lot: ["4516944"] })],
    );

    expect(decorated.features[1].properties).toMatchObject({
      noLot: "4 516 944",
      signalProjection: "direct",
    });
  });

  it("inherits zone-level signal state to linked lots when no direct lot ref exists", () => {
    const decorated = decorateLotsWithSignalProjection(
      lots(),
      [zone("H-609", ["4 516 943", "4 516 944"])],
      [signal("sig-1", { zone_ref: "H-609" })],
    );

    expect(decorated.features.map((feature) => feature.properties.signalProjection ?? "none"))
      .toEqual(["inherited", "inherited", "none"]);
  });

  it("keeps direct lot evidence stronger than inherited zone context", () => {
    const decorated = decorateLotsWithSignalProjection(
      lots(),
      [zone("H-609", ["4 516 943", "4 516 944"])],
      [
        signal("sig-zone", { zone_ref: "H-609" }),
        signal("sig-lot", { noLot: "4 516 943" }),
      ],
    );

    expect(decorated.features[0].properties.signalProjection).toBe("direct");
    expect(decorated.features[1].properties.signalProjection).toBe("inherited");
  });

  it("reads lot and zone refs from nested graph properties", () => {
    const decorated = decorateLotsWithSignalProjection(
      lots(),
      [zone("H-609", ["4 516 943", "4 516 944"])],
      [
        signal("sig-zone", { properties: { zone_ref: "H-609" } }),
        signal("sig-lot", { properties: { targets_lot: ["4516945"] } }),
      ],
    );

    expect(decorated.features.map((feature) => feature.properties.signalProjection ?? "none"))
      .toEqual(["inherited", "inherited", "direct"]);
  });
});
