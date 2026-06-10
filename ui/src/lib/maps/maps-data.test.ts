import { describe, it, expect } from "vitest";
import {
  buildCityMapEntries,
  computeBbox,
  projectToSvg,
  signalCountTier,
  PILOT_CITY_SLUG,
} from "./maps-data.js";

// MD1 — buildCityMapEntries returns only prioritized (non-excluded, non-deprioritized) cities
describe("buildCityMapEntries", () => {
  it("returns at least one city", () => {
    const entries = buildCityMapEntries({ maxCities: 20 });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("all entries have a municipality with lat/lon", () => {
    const entries = buildCityMapEntries({ maxCities: 10 });
    for (const e of entries) {
      expect(typeof e.municipality.lat).toBe("number");
      expect(typeof e.municipality.lon).toBe("number");
      expect(e.municipality.excluded).toBe(false);
    }
  });

  it("pilot city has real signal count > 0 (6m window)", () => {
    const entries = buildCityMapEntries();
    const pilot = entries.find((e) => e.municipality.slug === PILOT_CITY_SLUG);
    expect(pilot).toBeDefined();
    // 3 real + 2 simulation signals (excluding derogation-irrelevant which has 0 value)
    expect(pilot!.signalCount6m).toBeGreaterThan(0);
  });

  it("non-pilot cities have signalCount6m === 0 (anti-invention)", () => {
    const entries = buildCityMapEntries({ maxCities: 50 });
    const nonPilot = entries.filter((e) => e.municipality.slug !== PILOT_CITY_SLUG);
    for (const e of nonPilot) {
      expect(e.signalCount6m).toBe(0);
    }
  });

  it("ordered by priorityRank ascending (closest to MTL first)", () => {
    const entries = buildCityMapEntries({ maxCities: 10 });
    const ranks = entries.map((e) => e.municipality.priorityRank ?? Infinity);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });
});

// MD2 — computeBbox
describe("computeBbox", () => {
  it("returns a valid bbox for a list of municipalities", () => {
    const entries = buildCityMapEntries({ maxCities: 5 });
    const cities = entries.map((e) => e.municipality);
    const bbox = computeBbox(cities);
    expect(bbox.minLon).toBeLessThan(bbox.maxLon);
    expect(bbox.minLat).toBeLessThan(bbox.maxLat);
  });

  it("returns a Quebec province fallback for empty input", () => {
    const bbox = computeBbox([]);
    expect(bbox.minLon).toBeLessThan(-70);
    expect(bbox.maxLat).toBeGreaterThan(55);
  });
});

// MD3 — projectToSvg
describe("projectToSvg", () => {
  const bbox = { minLon: -80, minLat: 44, maxLon: -57, maxLat: 63 };

  it("returns x/y within SVG viewport", () => {
    const { x, y } = projectToSvg(-73.5, 45.5, bbox, 800, 600);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(800);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(600);
  });

  it("top-left corner maps to approximately (0, 0)", () => {
    const { x, y } = projectToSvg(-80, 63, bbox, 800, 600);
    expect(x).toBeCloseTo(0, 0);
    expect(y).toBeCloseTo(0, 0);
  });

  it("bottom-right corner maps to approximately (width, height)", () => {
    const { x, y } = projectToSvg(-57, 44, bbox, 800, 600);
    expect(x).toBeCloseTo(800, 0);
    expect(y).toBeCloseTo(600, 0);
  });
});

// MD4 — signalCountTier
describe("signalCountTier", () => {
  it("count 0 -> slate (no signal)", () => {
    const t = signalCountTier(0);
    expect(t.fill).toContain("slate");
  });

  it("count 1-2 -> amber", () => {
    expect(signalCountTier(1).fill).toContain("amber");
    expect(signalCountTier(2).fill).toContain("amber");
  });

  it("count 3-5 -> orange", () => {
    expect(signalCountTier(3).fill).toContain("orange");
  });

  it("count 6+ -> red", () => {
    expect(signalCountTier(6).fill).toContain("red");
  });
});
