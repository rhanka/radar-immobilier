import { describe, it, expect } from "vitest";
import {
  buildCityMapEntries,
  computeBbox,
  projectToSvg,
  signalCountTier,
  PILOT_CITY_SLUG,
} from "./maps-data.js";
import type { GraphSignalCityItem } from "$lib/signals/graph-signals-by-city-client.js";

const EMPTY_API: GraphSignalCityItem[] = [];

const VALLEYFIELD_ITEM: GraphSignalCityItem = {
  citySlug: PILOT_CITY_SLUG,
  signalCount: 3,
  subsetCounts: { "": 3, z: 2 },
};

// MD1 — buildCityMapEntries returns only prioritized (non-excluded, non-deprioritized) cities
describe("buildCityMapEntries", () => {
  it("returns at least one city even with empty API items", () => {
    const entries = buildCityMapEntries(EMPTY_API, { maxCities: 20 });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("all entries have a municipality with lat/lon", () => {
    const entries = buildCityMapEntries(EMPTY_API, { maxCities: 10 });
    for (const e of entries) {
      expect(typeof e.municipality.lat).toBe("number");
      expect(typeof e.municipality.lon).toBe("number");
      expect(e.municipality.excluded).toBe(false);
    }
  });

  it("cities absent from API items have signalCount6m === 0 (anti-invention)", () => {
    const entries = buildCityMapEntries(EMPTY_API, { maxCities: 50 });
    for (const e of entries) {
      expect(e.signalCount6m).toBe(0);
    }
  });

  it("pilot city gets count from real API data", () => {
    // No maxCities limit to ensure pilot city (any rank) is included.
    const entries = buildCityMapEntries([VALLEYFIELD_ITEM]);
    const pilot = entries.find((e) => e.municipality.slug === PILOT_CITY_SLUG);
    expect(pilot).toBeDefined();
    expect(pilot!.signalCount6m).toBe(3);
  });

  it("non-pilot cities remain 0 when only pilot appears in API response", () => {
    // No maxCities limit — check all cities.
    const entries = buildCityMapEntries([VALLEYFIELD_ITEM]);
    const nonPilot = entries.filter((e) => e.municipality.slug !== PILOT_CITY_SLUG);
    for (const e of nonPilot) {
      expect(e.signalCount6m).toBe(0);
    }
  });

  it("multiple cities with counts are correctly indexed", () => {
    const items: GraphSignalCityItem[] = [
      { citySlug: PILOT_CITY_SLUG, signalCount: 4, subsetCounts: { "": 4 } },
      { citySlug: "beauharnois", signalCount: 2, subsetCounts: { "": 2 } },
    ];
    // No maxCities limit — ensure pilot city (wherever it ranks) is included.
    const entries = buildCityMapEntries(items);
    const vf = entries.find((e) => e.municipality.slug === PILOT_CITY_SLUG);
    const bh = entries.find((e) => e.municipality.slug === "beauharnois");
    expect(vf).toBeDefined();
    expect(vf!.signalCount6m).toBe(4);
    if (bh) expect(bh.signalCount6m).toBe(2);
  });

  it("ordered by priorityRank ascending (closest to MTL first)", () => {
    const entries = buildCityMapEntries(EMPTY_API, { maxCities: 10 });
    const ranks = entries.map((e) => e.municipality.priorityRank ?? Infinity);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it("cities absent from graphItems have empty subsetCounts", () => {
    const entries = buildCityMapEntries(EMPTY_API, { maxCities: 5 });
    for (const e of entries) {
      expect(e.subsetCounts).toEqual({});
    }
  });

  it("subsetCounts is populated from graphItems", () => {
    const graphItems: GraphSignalCityItem[] = [
      {
        citySlug: PILOT_CITY_SLUG,
        signalCount: 5,
        subsetCounts: { "": 5, z: 3, "z|m": 1 },
      },
    ];
    const entries = buildCityMapEntries(graphItems);
    const pilot = entries.find((e) => e.municipality.slug === PILOT_CITY_SLUG);
    expect(pilot).toBeDefined();
    expect(pilot!.subsetCounts).toEqual({ "": 5, z: 3, "z|m": 1 });
  });

  it("graphItems sans subsetCounts explicite donnent subsetCounts={} (backward-compat)", () => {
    // Simule une réponse ancienne sans subsetCounts (cast via unknown pour simuler
    // la sérialisation JSON qui ignorerait un champ absent).
    const graphItems = [
      { citySlug: PILOT_CITY_SLUG, signalCount: 5 } as unknown as GraphSignalCityItem,
    ];
    const entries = buildCityMapEntries(graphItems);
    const pilot = entries.find((e) => e.municipality.slug === PILOT_CITY_SLUG);
    expect(pilot).toBeDefined();
    expect(pilot!.subsetCounts).toEqual({});
  });
});

// MD2 — computeBbox
describe("computeBbox", () => {
  it("returns a valid bbox for a list of municipalities", () => {
    const entries = buildCityMapEntries(EMPTY_API, { maxCities: 5 });
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
