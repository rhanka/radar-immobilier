import { describe, expect, it } from "vitest";
import {
  geoZonesRoute,
  type OfficialZoneProvider,
  type ZoneLotProvider,
} from "./geo-zones.js";
import type { ZoneLotInput } from "../services/geo/zones.js";

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

describe("GET /api/geo/:city/zones — official", () => {
  it("returns official zones before lot fallback when official geometry exists", async () => {
    const officialZoneProvider: OfficialZoneProvider = () => [
      { code: "M-216", citySlug: "delson", label: "Mixed", geometry: LOT_GEOMETRY },
    ];
    const lotProvider: ZoneLotProvider = () => [
      { noLot: "3 131 014", citySlug: "delson", zoneCode: "M-216", geometry: LOT_GEOMETRY },
    ];
    const app = geoZonesRoute({ officialZoneProvider, lotProvider });

    const res = await app.request("/api/geo/delson/zones?fallback=lots");
    const body = await res.json() as {
      ok: boolean;
      source: string;
      resolutionStatus: string;
      geometryStatus: string;
      zoneCount: number;
      featureCollection: { features: Array<{ properties: { code: string; lotCount: number } }> };
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe("official");
    expect(body.resolutionStatus).toBe("official");
    expect(body.geometryStatus).toBe("official");
    expect(body.zoneCount).toBe(1);
    expect(body.featureCollection.features[0]?.properties.code).toBe("M-216");
    expect(body.featureCollection.features[0]?.properties.lotCount).toBe(1);
  });

  it("does not expose PII from lot fallback properties attached to official zones", async () => {
    const officialZoneProvider: OfficialZoneProvider = () => [
      { code: "M-216", citySlug: "delson", geometry: LOT_GEOMETRY },
    ];
    const lotWithPii = {
      noLot: "3 131 014",
      citySlug: "delson",
      zoneCode: "M-216",
      geometry: LOT_GEOMETRY,
      adresse: "123 Example Street",
      valTotale: 123456,
    } as ZoneLotInput & Record<string, unknown>;
    const lotProvider: ZoneLotProvider = () => [
      lotWithPii,
    ];
    const app = geoZonesRoute({ officialZoneProvider, lotProvider });

    const res = await app.request("/api/geo/delson/zones?fallback=lots");
    const json = JSON.stringify(await res.json());

    expect(json).toContain("3 131 014");
    expect(json).not.toContain("Example Street");
    expect(json).not.toContain("valTotale");
    expect(json).not.toContain("123456");
  });
});

describe("GET /api/geo/:city/zones — lot fallback", () => {
  it("groups lots by zone when fallback=lots and no official zone exists", async () => {
    const officialZoneProvider: OfficialZoneProvider = () => [];
    const lotProvider: ZoneLotProvider = () => [
      { noLot: "3 131 014", citySlug: "delson", zoneCode: "M-216", geometry: LOT_GEOMETRY },
      { noLot: "4 022 156", citySlug: "delson", zoneCode: "M-216", geometry: LOT_GEOMETRY },
    ];
    const app = geoZonesRoute({ officialZoneProvider, lotProvider });

    const res = await app.request("/api/geo/delson/zones?fallback=lots");
    const body = await res.json() as {
      source: string;
      resolutionStatus: string;
      geometryStatus: string;
      warnings: string[];
      featureCollection: {
        features: Array<{
          geometry: { type: string };
          properties: { confidence: number; lotCount: number; source: string };
        }>;
      };
    };

    expect(body.source).toBe("lot-union-fallback");
    expect(body.resolutionStatus).toBe("fallback");
    expect(body.geometryStatus).toBe("lot-union-fallback");
    expect(body.warnings).toContain("lot-union-fallback-is-visual-only");
    expect(body.featureCollection.features[0]?.geometry.type).toBe("MultiPolygon");
    expect(body.featureCollection.features[0]?.properties.lotCount).toBe(2);
    expect(body.featureCollection.features[0]?.properties.source).toBe("lot-zone-fallback");
  });

  it("returns missing when fallback is not requested and no official zones exist", async () => {
    const app = geoZonesRoute({
      officialZoneProvider: () => [],
      lotProvider: () => [
        { noLot: "3 131 014", citySlug: "delson", zoneCode: "M-216", geometry: LOT_GEOMETRY },
      ],
    });

    const res = await app.request("/api/geo/delson/zones");
    const body = await res.json() as {
      source: string;
      resolutionStatus: string;
      geometryStatus: string;
      zoneCount: number;
    };

    expect(body.source).toBe("none");
    expect(body.resolutionStatus).toBe("missing");
    expect(body.geometryStatus).toBe("missing");
    expect(body.zoneCount).toBe(0);
  });

  it("candiac remains missing because simulation lots carry empty zone codes", async () => {
    const app = geoZonesRoute();
    const res = await app.request("/api/geo/candiac/zones?fallback=lots&limit=25");
    const body = await res.json() as {
      citySlug: string;
      source: string;
      resolutionStatus: string;
      geometryStatus: string;
      zoneCount: number;
      featureCollection: { features: unknown[] };
    };

    expect(res.status).toBe(200);
    expect(body.citySlug).toBe("candiac");
    expect(body.source).toBe("none");
    expect(body.resolutionStatus).toBe("missing");
    expect(body.geometryStatus).toBe("missing");
    expect(body.zoneCount).toBe(0);
    expect(body.featureCollection.features).toHaveLength(0);
  });
});

describe("GET /api/geo/:city/zones — params", () => {
  it("returns 400 for invalid fallback values", async () => {
    const app = geoZonesRoute();
    const res = await app.request("/api/geo/delson/zones?fallback=official");
    const body = await res.json() as { ok: boolean; error: string };

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid-param");
  });
});
