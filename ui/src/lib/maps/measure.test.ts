import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  totalDistanceMeters,
  lastSegmentMeters,
  formatDistanceFr,
  buildMeasureLineData,
  buildMeasurePointsData,
  type LngLatTuple,
} from "./measure.js";

describe("haversineMeters", () => {
  it("renvoie 0 pour deux points identiques", () => {
    expect(haversineMeters([-73.5, 45.7], [-73.5, 45.7])).toBe(0);
  });

  it("mesure 1° de latitude ≈ 111,195 km (πR/180, R = 6371 km)", () => {
    // Valeur analytique exacte sur la sphère : π × 6 371 000 / 180.
    const expected = (Math.PI * 6_371_000) / 180; // ≈ 111 194,93 m
    expect(haversineMeters([0, 0], [0, 1])).toBeCloseTo(expected, 6);
  });

  it("mesure 1° de longitude à 60° de latitude ≈ moitié d'un degré équatorial", () => {
    // À lat 60°, cos(60°) = 0,5 : un degré de longitude vaut ~55,6 km.
    const equatorDegree = (Math.PI * 6_371_000) / 180;
    const d = haversineMeters([0, 60], [1, 60]);
    expect(d).toBeGreaterThan(equatorDegree * 0.499);
    expect(d).toBeLessThan(equatorDegree * 0.501);
  });

  it("Salaberry-de-Valleyfield → Delson ≈ 48,3 km (référence géodésique)", () => {
    // Centres approximatifs : Valleyfield (-74.13, 45.25), Delson (-73.55, 45.40).
    const valleyfield: LngLatTuple = [-74.13, 45.25];
    const delson: LngLatTuple = [-73.55, 45.4];
    const d = haversineMeters(valleyfield, delson);
    // Décomposition analytique : Δlat 0,15° ≈ 16,7 km ; Δlng 0,58° × cos(45,3°) ≈ 45,4 km.
    // Hypoténuse sphérique ≈ √(16,7² + 45,4²) ≈ 48,4 km.
    expect(d / 1000).toBeGreaterThan(47.9);
    expect(d / 1000).toBeLessThan(48.9);
  });

  it("est symétrique", () => {
    const a: LngLatTuple = [-73.5, 45.7];
    const b: LngLatTuple = [-71.2, 46.8];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 9);
  });
});

describe("totalDistanceMeters / lastSegmentMeters", () => {
  const degree = (Math.PI * 6_371_000) / 180;

  it("renvoie 0 pour 0 ou 1 point", () => {
    expect(totalDistanceMeters([])).toBe(0);
    expect(totalDistanceMeters([[0, 0]])).toBe(0);
    expect(lastSegmentMeters([[0, 0]])).toBe(0);
  });

  it("cumule les segments consécutifs le long du méridien", () => {
    const points: LngLatTuple[] = [
      [0, 0],
      [0, 1],
      [0, 3],
    ];
    expect(totalDistanceMeters(points)).toBeCloseTo(3 * degree, 6);
    expect(lastSegmentMeters(points)).toBeCloseTo(2 * degree, 6);
  });
});

describe("formatDistanceFr", () => {
  it("affiche les mètres entiers sous 1 km", () => {
    expect(formatDistanceFr(340)).toBe("340 m");
    expect(formatDistanceFr(340.4)).toBe("340 m");
    expect(formatDistanceFr(999.4)).toBe("999 m");
    expect(formatDistanceFr(0)).toBe("0 m");
  });

  it("bascule en km (1 décimale, virgule FR) dès 1 km", () => {
    expect(formatDistanceFr(1234)).toBe("1,2 km");
    expect(formatDistanceFr(999.6)).toBe("1 km");
    expect(formatDistanceFr(2050)).toBe("2,1 km");
    expect(formatDistanceFr(12_340)).toBe("12,3 km");
  });

  it("omet la décimale inutile (« 2 km », pas « 2,0 km »)", () => {
    expect(formatDistanceFr(2000)).toBe("2 km");
    expect(formatDistanceFr(1999.9)).toBe("2 km");
  });

  it("neutralise les entrées invalides (NaN, négatif)", () => {
    expect(formatDistanceFr(Number.NaN)).toBe("0 m");
    expect(formatDistanceFr(-42)).toBe("0 m");
  });
});

describe("buildMeasureLineData / buildMeasurePointsData", () => {
  it("ligne : collection vide sous 2 points (pas de LineString dégénérée)", () => {
    expect(buildMeasureLineData([]).features).toEqual([]);
    expect(buildMeasureLineData([[0, 0]]).features).toEqual([]);
  });

  it("ligne : une LineString unique reliant les sommets dans l'ordre", () => {
    const points: LngLatTuple[] = [
      [-74.13, 45.25],
      [-73.55, 45.4],
      [-73.5, 45.7],
    ];
    const data = buildMeasureLineData(points);
    expect(data.features).toHaveLength(1);
    expect(data.features[0].geometry).toEqual({
      type: "LineString",
      coordinates: points,
    });
  });

  it("points : un Feature Point par sommet, indexé par ordre de clic", () => {
    const points: LngLatTuple[] = [
      [-74.13, 45.25],
      [-73.55, 45.4],
    ];
    const data = buildMeasurePointsData(points);
    expect(data.features).toHaveLength(2);
    expect(data.features[0].geometry.coordinates).toEqual([-74.13, 45.25]);
    expect(data.features[1].properties.index).toBe(1);
  });
});
