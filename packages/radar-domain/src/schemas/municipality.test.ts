import { describe, it, expect } from "vitest";
import { Municipality, PrioritizedCitiesOptions } from "./municipality.js";

/** Haversine distance (km) — same formula as the data generation script. */
function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371.0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

const MTL_LAT = 45.5019;
const MTL_LON = -73.5674;

describe("Municipality schema", () => {
  it("parses a valid municipality record", () => {
    const result = Municipality.safeParse({
      slug: "salaberry-de-valleyfield",
      name: "Salaberry-de-Valleyfield",
      mrc: "Beauharnois-Salaberry",
      lat: 45.2555575,
      lon: -74.1316718,
      population: 41000,
      distanceToMtlKm: 65.8,
      priorityRank: 120,
      excluded: false,
      excludedReason: null,
      deprioritized: false,
    });
    expect(result.success).toBe(true);
  });

  it("parses a municipality with null mrc (agglomeration city)", () => {
    const result = Municipality.safeParse({
      slug: "brossard",
      name: "Brossard",
      mrc: null,
      lat: 45.45,
      lon: -73.46,
      population: 98240,
      distanceToMtlKm: 10.7,
      priorityRank: 8,
      excluded: false,
      excludedReason: null,
      deprioritized: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid excludedReason value", () => {
    const result = Municipality.safeParse({
      slug: "montreal",
      name: "Montréal",
      mrc: null,
      lat: 45.52662,
      lon: -73.6527,
      population: 1913561,
      distanceToMtlKm: 7.2,
      priorityRank: null,
      excluded: true,
      excludedReason: "not-a-valid-reason",
      deprioritized: false,
    });
    expect(result.success).toBe(false);
  });

  it("accepts pilot-city-montreal as excludedReason", () => {
    const result = Municipality.safeParse({
      slug: "montreal",
      name: "Montréal",
      mrc: null,
      lat: 45.52662,
      lon: -73.6527,
      population: 1913561,
      distanceToMtlKm: 7.2,
      priorityRank: null,
      excluded: true,
      excludedReason: "pilot-city-montreal",
      deprioritized: false,
    });
    expect(result.success).toBe(true);
  });
});

describe("PrioritizedCitiesOptions schema", () => {
  it("applies default includeLargePop=false", () => {
    const result = PrioritizedCitiesOptions.parse({ maxKm: 50 });
    expect(result.includeLargePop).toBe(false);
    expect(result.maxKm).toBe(50);
  });

  it("accepts includeLargePop: true", () => {
    const result = PrioritizedCitiesOptions.parse({ includeLargePop: true });
    expect(result.includeLargePop).toBe(true);
    expect(result.maxKm).toBeUndefined();
  });
});

describe("Haversine distance calculation", () => {
  it("computes Montréal → Montréal as 0 km", () => {
    expect(haversine(MTL_LAT, MTL_LON, MTL_LAT, MTL_LON)).toBeCloseTo(0, 5);
  });

  it("computes Montréal → Salaberry-de-Valleyfield ≈ 47 km", () => {
    // GeoNames centroid for Salaberry-de-Valleyfield (id=8673897): 45.2651, -74.06482
    const d = haversine(MTL_LAT, MTL_LON, 45.2651, -74.06482);
    expect(d).toBeGreaterThan(42);
    expect(d).toBeLessThan(52);
  });

  it("computes Montréal → Westmount ≈ 3.2 km", () => {
    // Real coords: 45.48535, -73.60072
    const d = haversine(MTL_LAT, MTL_LON, 45.48535, -73.60072);
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(5);
  });

  it("is symmetric (a→b = b→a)", () => {
    const d1 = haversine(45.5019, -73.5674, 45.2555575, -74.1316718);
    const d2 = haversine(45.2555575, -74.1316718, 45.5019, -73.5674);
    expect(d1).toBeCloseTo(d2, 10);
  });
});
