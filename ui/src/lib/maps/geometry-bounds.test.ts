import { describe, it, expect } from "vitest";
import {
  geometryBounds,
  unionBounds,
  isDegenerateBounds,
  QUEBEC_PROVINCE_BOUNDS,
  type LngLatBoundsTuple,
} from "./geometry-bounds.js";
import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";

describe("geometryBounds", () => {
  it("renvoie null pour une géométrie nulle", () => {
    expect(geometryBounds(null)).toBeNull();
    expect(geometryBounds(undefined)).toBeNull();
  });

  it("renvoie null pour une géométrie sans coordonnée finie", () => {
    const empty: GeoJsonGeometry = { type: "Polygon", coordinates: [] };
    expect(geometryBounds(empty)).toBeNull();
  });

  it("calcule la bbox d'un Point (étendue dégénérée)", () => {
    const point: GeoJsonGeometry = { type: "Point", coordinates: [-73.5, 45.7] };
    const b = geometryBounds(point);
    expect(b).toEqual([
      [-73.5, 45.7],
      [-73.5, 45.7],
    ]);
    expect(isDegenerateBounds(b as LngLatBoundsTuple)).toBe(true);
  });

  it("calcule la bbox d'un Polygon simple", () => {
    const poly: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [-73.55, 45.36],
          [-73.51, 45.36],
          [-73.51, 45.39],
          [-73.55, 45.39],
          [-73.55, 45.36],
        ],
      ],
    };
    const b = geometryBounds(poly);
    expect(b).toEqual([
      [-73.55, 45.36],
      [-73.51, 45.39],
    ]);
    expect(isDegenerateBounds(b as LngLatBoundsTuple)).toBe(false);
  });

  it("calcule la bbox d'un MultiPolygon (récursion profonde)", () => {
    const mp: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-74.0, 45.0],
            [-73.9, 45.0],
            [-73.9, 45.1],
            [-74.0, 45.0],
          ],
        ],
        [
          [
            [-73.5, 45.5],
            [-73.4, 45.5],
            [-73.4, 45.6],
            [-73.5, 45.5],
          ],
        ],
      ],
    };
    const b = geometryBounds(mp);
    expect(b).toEqual([
      [-74.0, 45.0],
      [-73.4, 45.6],
    ]);
  });

  it("calcule la bbox d'une GeometryCollection", () => {
    const gc: GeoJsonGeometry = {
      type: "GeometryCollection",
      // coordinates absent — la collection porte `geometries`.
      coordinates: undefined as never,
      ...({ geometries: [
        { type: "Point", coordinates: [-73.0, 45.0] },
        { type: "Point", coordinates: [-72.0, 46.0] },
      ] } as object),
    } as GeoJsonGeometry;
    const b = geometryBounds(gc);
    expect(b).toEqual([
      [-73.0, 45.0],
      [-72.0, 46.0],
    ]);
  });

  it("ignore les coordonnées non finies (NaN)", () => {
    const poly: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [-73.5, 45.3],
          [NaN, NaN],
          [-73.4, 45.4],
        ],
      ],
    };
    const b = geometryBounds(poly);
    expect(b).toEqual([
      [-73.5, 45.3],
      [-73.4, 45.4],
    ]);
  });
});

describe("unionBounds", () => {
  it("renvoie null si aucune géométrie exploitable", () => {
    expect(unionBounds([null, undefined])).toBeNull();
  });

  it("fusionne les bbox de plusieurs géométries", () => {
    const a: GeoJsonGeometry = { type: "Point", coordinates: [-74.0, 45.0] };
    const b: GeoJsonGeometry = { type: "Point", coordinates: [-73.0, 46.0] };
    expect(unionBounds([a, null, b])).toEqual([
      [-74.0, 45.0],
      [-73.0, 46.0],
    ]);
  });

  it("ignore les géométries nulles intercalées", () => {
    const a: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [-73.6, 45.3],
          [-73.5, 45.3],
          [-73.5, 45.4],
          [-73.6, 45.3],
        ],
      ],
    };
    expect(unionBounds([null, a, undefined])).toEqual([
      [-73.6, 45.3],
      [-73.5, 45.4],
    ]);
  });
});

describe("QUEBEC_PROVINCE_BOUNDS", () => {
  it("couvre l'étendue provinciale (sud-ouest → nord-est)", () => {
    expect(QUEBEC_PROVINCE_BOUNDS[0][0]).toBeLessThan(QUEBEC_PROVINCE_BOUNDS[1][0]);
    expect(QUEBEC_PROVINCE_BOUNDS[0][1]).toBeLessThan(QUEBEC_PROVINCE_BOUNDS[1][1]);
  });
});
