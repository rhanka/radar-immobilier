/**
 * zone-membership — appartenance géométrique point ↔ zone (ray-casting pur).
 *
 * Support du contrat caméra « lot suivant » : un lot n'est recadré (fitBounds)
 * que s'il tombe POSITIVEMENT dans une autre zone que le lot précédent — la
 * résolution doit donc être fiable (trous, MultiPolygon) et honnête (`null`
 * quand indéterminé), jamais inventée.
 */
import { describe, it, expect } from "vitest";
import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";
import { geometryContainsPoint, zoneCodeAtPoint } from "./zone-membership.js";

const square = (
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
): number[][] => [
  [minLon, minLat],
  [maxLon, minLat],
  [maxLon, maxLat],
  [minLon, maxLat],
  [minLon, minLat],
];

const polygon = (rings: number[][][]): GeoJsonGeometry => ({
  type: "Polygon",
  coordinates: rings,
});

describe("geometryContainsPoint", () => {
  it("point dans / hors d'un Polygon simple", () => {
    const poly = polygon([square(-73.57, 45.33, -73.54, 45.36)]);
    expect(geometryContainsPoint(poly, [-73.55, 45.345])).toBe(true);
    expect(geometryContainsPoint(poly, [-73.5, 45.345])).toBe(false);
  });

  it("point dans un TROU du polygone → non contenu", () => {
    const poly = polygon([
      square(0, 0, 10, 10),
      square(4, 4, 6, 6), // trou central
    ]);
    expect(geometryContainsPoint(poly, [5, 5])).toBe(false);
    expect(geometryContainsPoint(poly, [2, 2])).toBe(true);
  });

  it("MultiPolygon : contenu si dans L'UN des polygones", () => {
    const multi: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [square(0, 0, 1, 1)],
        [square(10, 10, 11, 11)],
      ],
    };
    expect(geometryContainsPoint(multi, [10.5, 10.5])).toBe(true);
    expect(geometryContainsPoint(multi, [5, 5])).toBe(false);
  });

  it("géométrie nulle ou non surfacique → jamais contenu", () => {
    expect(geometryContainsPoint(null, [0, 0])).toBe(false);
    expect(
      geometryContainsPoint({ type: "Point", coordinates: [0, 0] }, [0, 0]),
    ).toBe(false);
  });
});

describe("zoneCodeAtPoint", () => {
  const zones = [
    { geometry: polygon([square(-73.57, 45.33, -73.54, 45.36)]), properties: { code: "VP-101" } },
    { geometry: polygon([square(-73.53, 45.33, -73.5, 45.36)]), properties: { code: "VP-102" } },
    { geometry: null, properties: { code: "VP-103" } }, // zone sans géométrie : ignorée
  ];

  it("résout le code de la zone contenant le point", () => {
    expect(zoneCodeAtPoint(zones, [-73.55, 45.34])).toBe("VP-101");
    expect(zoneCodeAtPoint(zones, [-73.52, 45.34])).toBe("VP-102");
  });

  it("point hors de toute zone (ou collection absente) → null, jamais inventé", () => {
    expect(zoneCodeAtPoint(zones, [-73.4, 45.34])).toBeNull();
    expect(zoneCodeAtPoint(null, [-73.55, 45.34])).toBeNull();
  });
});
