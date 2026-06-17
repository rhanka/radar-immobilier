import { describe, expect, it } from "vitest";
import {
  lotFallbackConfidence,
  normalizeZonesAndLots,
  officialZoneConfidence,
  type ZoneLotInput,
} from "./zones.js";

const LOT_GEOMETRY = {
  type: "Polygon",
  coordinates: [
    [
      [-73.55, 45.38],
      [-73.54, 45.38],
      [-73.54, 45.39],
      [-73.55, 45.39],
      [-73.55, 45.38],
    ],
  ],
};

describe("normalizeZonesAndLots — official zones", () => {
  it("prefers official zone geometry and rejects empty zone codes", () => {
    const result = normalizeZonesAndLots({
      citySlug: "delson",
      officialZones: [
        { code: "M-216", label: "Mixed", geometry: LOT_GEOMETRY },
        { code: "", label: "Empty", geometry: LOT_GEOMETRY },
      ],
      lots: [
        { noLot: "3 131 014", citySlug: "delson", zoneCode: "M-216", geometry: LOT_GEOMETRY },
        { noLot: "4 022 156", citySlug: "delson", zoneCode: "", geometry: LOT_GEOMETRY },
      ],
      opts: { includeLotFallback: true },
    });

    expect(result.resolutionStatus).toBe("official");
    expect(result.geometryStatus).toBe("official");
    expect(result.featureCollection.features).toHaveLength(1);
    expect(result.featureCollection.features[0]?.properties.code).toBe("M-216");
    expect(result.featureCollection.features[0]?.properties.geometryStatus).toBe("official");
    expect(result.featureCollection.features[0]?.properties.lotCount).toBe(1);
  });

  it("does not expose lot PII fields through normalized zone lots", () => {
    const lotWithPii = {
      noLot: "3 131 014",
      citySlug: "delson",
      zoneCode: "M-216",
      geometry: LOT_GEOMETRY,
      address: "123 Example Street",
      ownerName: "Private Owner",
    } as ZoneLotInput & Record<string, unknown>;

    const result = normalizeZonesAndLots({
      citySlug: "delson",
      officialZones: [{ code: "M-216", geometry: LOT_GEOMETRY }],
      lots: [lotWithPii],
    });

    const json = JSON.stringify(result);
    expect(json).toContain("3 131 014");
    expect(json).not.toContain("Example Street");
    expect(json).not.toContain("Private Owner");
  });
});

describe("normalizeZonesAndLots — lot fallback", () => {
  it("groups lots by zone with explicit lot-union-fallback geometry status", () => {
    const result = normalizeZonesAndLots({
      citySlug: "delson",
      lots: [
        { noLot: "3 131 014", citySlug: "delson", zoneCode: "M-216", geometry: LOT_GEOMETRY },
        { noLot: "4 022 156", citySlug: "delson", zoneCode: "M-216", geometry: LOT_GEOMETRY },
        { noLot: "6 057 912", citySlug: "delson", zoneCode: "I-421", geometry: LOT_GEOMETRY },
      ],
      opts: { includeLotFallback: true },
    });

    expect(result.resolutionStatus).toBe("fallback");
    expect(result.geometryStatus).toBe("lot-union-fallback");
    expect(result.warnings).toContain("lot-union-fallback-is-visual-only");
    expect(result.featureCollection.features).toHaveLength(2);

    const mixed = result.featureCollection.features.find((feature) => feature.properties.code === "M-216");
    expect(mixed?.geometry?.type).toBe("MultiPolygon");
    expect(mixed?.properties.lotCount).toBe(2);
    expect(mixed?.properties.source).toBe("lot-zone-fallback");
  });

  it("keeps fallback confidence below official confidence", () => {
    expect(lotFallbackConfidence()).toBeLessThan(officialZoneConfidence());
  });

  it("returns missing when lots only carry empty zone codes", () => {
    const result = normalizeZonesAndLots({
      citySlug: "candiac",
      lots: [
        { noLot: "3758501", citySlug: "candiac", zoneCode: "", geometry: LOT_GEOMETRY },
        { noLot: "4239017", citySlug: "candiac", zoneCode: "N/D", geometry: LOT_GEOMETRY },
      ],
      opts: { includeLotFallback: true },
    });

    expect(result.resolutionStatus).toBe("missing");
    expect(result.geometryStatus).toBe("missing");
    expect(result.featureCollection.features).toHaveLength(0);
  });

  it("returns text-only fallback when lot geometries are absent", () => {
    const result = normalizeZonesAndLots({
      citySlug: "delson",
      lots: [
        { noLot: "3 131 014", citySlug: "delson", zoneCode: "M-216", geometry: null },
      ],
      opts: { includeLotFallback: true },
    });

    expect(result.resolutionStatus).toBe("fallback");
    expect(result.geometryStatus).toBe("text-only");
    expect(result.featureCollection.features[0]?.geometry).toBeNull();
    expect(result.featureCollection.features[0]?.properties.geometryStatus).toBe("text-only");
  });
});
