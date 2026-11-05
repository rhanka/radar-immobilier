import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAP_KIT_ASSETS } from "@radar/artifacts-host";
import {
  bboxOf,
  countTilesForBounds,
  createMap,
  evaluatePaint,
  expandTemplate,
  findFeatureAt,
  FIT_Z,
  MAX_CACHED_TILES,
  MAX_TILES_PER_FRAME,
  MAX_TILE_RETRIES,
  MAX_TILE_ZOOM,
  MIN_TILE_ZOOM,
  TILE_RETRY_BASE_MS,
  perLayerTileBudget,
  planTileEviction,
  pointInRing,
  tilesForBounds,
  tilesForView,
  tileToLonLat,
  tileXY,
  tileZoomForExtent,
  tileZoomForScale,
  validateBasemapTemplate,
} from "../../src/artifacts/design-assets/map-base.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "map-i4");
const designAssets = join(here, "..", "..", "src", "artifacts", "design-assets");

type Properties = Record<string, unknown>;
interface TestFeature {
  readonly type: "Feature";
  readonly properties: Properties;
  readonly geometry: { readonly type: string; readonly coordinates: unknown } | null;
}

function load(name: string) {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as {
    readonly type: string;
    readonly numberMatched: number;
    readonly numberReturned: number;
    readonly features: TestFeature[];
  };
}

/** Independent point-in-ring oracle (duplicated on purpose, not shared code). */
function oracleInside(lon: number, lat: number, ring: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function oracleContains(geometry: TestFeature["geometry"], lon: number, lat: number): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const rings = geometry.coordinates as readonly (readonly number[])[];
    if (rings.length === 0 || !oracleInside(lon, lat, rings[0]!)) return false;
    return rings.slice(1).every((hole) => !oracleInside(lon, lat, hole));
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as unknown[]).some((polygon) =>
      oracleContains({ type: "Polygon", coordinates: polygon }, lon, lat));
  }
  return false;
}

function collectProperties(value: unknown, into: Properties[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectProperties(entry, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["type"] === "string" && "properties" in record &&
      record["properties"] !== null && typeof record["properties"] === "object") {
      into.push(record["properties"] as Properties);
    }
    for (const entry of Object.values(record)) collectProperties(entry, into);
  }
}

describe("map-i4 real fixtures", () => {
  it("should load the captured Longueuil zonage and lots subsets with their match counts", () => {
    const zones = load("zones-longueuil.geojson");
    const lots = load("lots-longueuil.geojson");
    expect(zones.type).toBe("FeatureCollection");
    expect(zones.features).toHaveLength(40);
    expect(zones.numberMatched).toBe(81);
    expect(zones.numberReturned).toBe(40);
    expect(lots.type).toBe("FeatureCollection");
    expect(lots.features).toHaveLength(80);
    expect(lots.numberMatched).toBe(1076);
    expect(lots.numberReturned).toBe(80);
  });

  it("should expose no address or code_postal field anywhere in the fixtures", () => {
    for (const name of ["zones-longueuil.geojson", "lots-longueuil.geojson"]) {
      const collection = load(name);
      const seen: Properties[] = [];
      collectProperties(collection, seen);
      expect(seen.length).toBeGreaterThan(0);
      for (const properties of seen) {
        for (const key of Object.keys(properties)) {
          expect(key.toLowerCase(), `${name}:${key}`).not.toMatch(/adress|postal|address/);
        }
      }
      const raw = readFileSync(join(fixtures, name), "utf8").toLowerCase();
      expect(raw).not.toContain("adresse");
      expect(raw).not.toContain("code_postal");
    }
  });

  it("should keep cadastral identifiers on every feature", () => {
    const zones = load("zones-longueuil.geojson");
    const lots = load("lots-longueuil.geojson");
    for (const feature of zones.features) {
      expect(typeof feature.properties["zone_code"]).toBe("string");
    }
    for (const feature of lots.features) {
      const identifier = feature.properties["NO_LOT"] ?? feature.properties["noLot"];
      expect(typeof identifier).not.toBe("undefined");
      expect(typeof feature.properties["zone_code"]).toBe("string");
    }
  });
});

describe("map-base geometry", () => {
  it("should bound the real collections around Longueuil", () => {
    const zones = load("zones-longueuil.geojson");
    const lots = load("lots-longueuil.geojson");
    for (const collection of [zones, lots]) {
      const box = bboxOf(collection);
      expect(box).not.toBeNull();
      const [minLon, minLat, maxLon, maxLat] = box!;
      expect(minLon).toBeGreaterThan(-74);
      expect(maxLon).toBeLessThan(-73);
      expect(minLat).toBeGreaterThan(45);
      expect(maxLat).toBeLessThan(46);
      expect(maxLon).toBeGreaterThan(minLon);
      expect(maxLat).toBeGreaterThan(minLat);
    }
    expect(bboxOf({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("should agree with an independent oracle on a grid over the real data", () => {
    const zones = load("zones-longueuil.geojson");
    const lots = load("lots-longueuil.geojson");
    const sources = { outlines: [], zones: zones.features, lots: lots.features };
    const box = bboxOf({ type: "FeatureCollection", features: [...zones.features, ...lots.features] })!;
    const [minLon, minLat, maxLon, maxLat] = box;
    // One assertion at the end: per-cell expects would format whole
    // GeoJSON features on mismatch, which buries the signal.
    const mismatches: string[] = [];
    let hits = 0;
    for (let gx = 0; gx < 12; gx += 1) {
      for (let gy = 0; gy < 12; gy += 1) {
        const lon = minLon + ((gx + 0.5) / 12) * (maxLon - minLon);
        const lat = minLat + ((gy + 0.5) / 12) * (maxLat - minLat);
        const found = findFeatureAt(sources, lon, lat);
        const contained = [...lots.features, ...zones.features]
          .filter((feature) => oracleContains(feature.geometry, lon, lat));
        if (found === null) {
          if (contained.length !== 0) mismatches.push(`cell ${gx},${gy}: bundle finds nothing, oracle contains ${contained.length}`);
        } else {
          hits += 1;
          if (!oracleContains(found.feature.geometry, lon, lat)) {
            mismatches.push(`cell ${gx},${gy}: bundle hit is not inside its own geometry`);
          }
          // Lots draw over zones: a lot hit wins over any zone hit.
          if (found.layer === "zones" &&
            lots.features.some((feature) => oracleContains(feature.geometry, lon, lat))) {
            mismatches.push(`cell ${gx},${gy}: zone hit while a lot contains the point`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(hits).toBeGreaterThan(10);
  });

  it("should hit-test layers topmost-first on synthetic polygons", () => {
    const square = (x0: number, y0: number, x1: number, y1: number): TestFeature => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
    });
    expect(pointInRing(0.5, 0.5, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])).toBe(true);
    expect(pointInRing(2, 2, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])).toBe(false);
    const sources = { outlines: [square(0, 0, 10, 10)], zones: [square(0, 0, 5, 5)], lots: [square(1, 1, 2, 2)] };
    expect(findFeatureAt(sources, 1.5, 1.5)?.layer).toBe("lots");
    expect(findFeatureAt(sources, 3, 3)?.layer).toBe("zones");
    expect(findFeatureAt(sources, 8, 8)?.layer).toBe("outlines");
    expect(findFeatureAt(sources, 20, 20)).toBeNull();
  });
});

describe("map-base paint expressions", () => {
  it("should resolve literal, function and stop-table colors with fallbacks", () => {
    const properties = { zone_code: "H34-045 (VLO)", surface_m2: 512 };
    expect(evaluatePaint({ fill: "#ff0000" }, properties).fill).toBe("#ff0000");
    expect(evaluatePaint({ fill: (props: Properties) => (props["surface_m2"] as number) > 500 ? "#00ff00" : "#0000ff" }, properties).fill)
      .toBe("#00ff00");
    expect(evaluatePaint({
      fill: { property: "zone_code", stops: [["H34-045 (VLO)", "#123456"]], fallback: "#abcdef" },
    }, properties).fill).toBe("#123456");
    expect(evaluatePaint({
      fill: { property: "zone_code", stops: [["OTHER", "#123456"]], fallback: "#abcdef" },
    }, properties).fill).toBe("#abcdef");
    expect(evaluatePaint({}, properties)).toEqual({ fill: "rgba(0,0,0,0)", stroke: "#3a3a3a", lineWidth: 1 });
    expect(evaluatePaint({ lineWidth: -2 }, properties).lineWidth).toBe(1);
  });

  it("should paint real zones by code and lots by surface through page expressions", () => {
    const zones = load("zones-longueuil.geojson");
    const lots = load("lots-longueuil.geojson");
    const firstCode = zones.features[0]!.properties["zone_code"];
    const paint = {
      zones: { fill: { property: "zone_code", stops: [[firstCode, "#ff0000"]], fallback: "#00ff00" }, stroke: "#111111" },
      lots: { fill: (props: Properties) => (Number(props["surface_m2"]) > 1000 ? "#0000ff" : "#ffff00") },
    };
    expect(evaluatePaint(paint.zones, zones.features[0]!.properties).fill).toBe("#ff0000");
    const other = zones.features.find((feature) => feature.properties["zone_code"] !== firstCode)!;
    expect(evaluatePaint(paint.zones, other.properties).fill).toBe("#00ff00");
    const fills = new Set(lots.features.map((feature) => evaluatePaint(paint.lots, feature.properties).fill));
    expect(fills.size).toBeGreaterThanOrEqual(1);
  });
});

describe("map-base basemap hook", () => {
  it("should accept only same-origin templates carrying z, x and y", () => {
    expect(validateBasemapTemplate(null)).toBeNull();
    expect(validateBasemapTemplate(undefined)).toBeNull();
    expect(validateBasemapTemplate("/tiles/{z}/{x}/{y}.png")).toBe("/tiles/{z}/{x}/{y}.png");
    expect(() => validateBasemapTemplate("https://tiles.example.com/{z}/{x}/{y}.png")).toThrow();
    expect(() => validateBasemapTemplate("/tiles/{z}/{x}.png")).toThrow();
    expect(() => validateBasemapTemplate(42)).toThrow();
  });

  it("should refuse protocol-relative, backslash and absolute template forms", () => {
    for (const hostile of [
      "//tiles.example.net/{z}/{x}/{y}.png",
      "//tiles.example.net/{z}/{x}/{y}",
      "/\\tiles.example.net/{z}/{x}/{y}",
      "/tiles\\{z}\\{x}\\{y}.png",
      "/tiles/{z}/{x}/{y}.png\\",
      "https://tiles.example.com/{z}/{x}/{y}.png",
      "http://tiles.example.com/{z}/{x}/{y}.png",
      "tiles/{z}/{x}/{y}.png",
      "",
    ]) {
      expect(() => validateBasemapTemplate(hostile), hostile).toThrow("same-origin path");
    }
  });

  it("should refuse tab, newline, CR, backslash and encoded-slash bypasses", () => {
    for (const hostile of [
      "/\t/tiles.example.net/{z}/{x}/{y}",
      "/\n/tiles.example.net/{z}/{x}/{y}",
      "/\r/tiles.example.net/{z}/{x}/{y}",
      "/ /tiles.example.net/{z}/{x}/{y}",
      "/tiles/{z}/{x}/{y}.png\n",
      "\\tiles.example.net/{z}/{x}/{y}",
      "/%2Ftiles.example.net/{z}/{x}/{y}",
      "/%2ftiles.example.net/{z}/{x}/{y}",
      "/%5Ctiles.example.net/{z}/{x}/{y}",
      "/tiles%2f{z}%2f{x}%2f{y}",
    ]) {
      expect(() => validateBasemapTemplate(hostile), JSON.stringify(hostile)).toThrow("same-origin path");
    }
  });

  it("should accept the real I-10A tile and labels templates", () => {
    expect(validateBasemapTemplate("/__artifacts/tiles/v1/{z}/{x}/{y}"))
      .toBe("/__artifacts/tiles/v1/{z}/{x}/{y}");
    expect(validateBasemapTemplate("/__artifacts/tiles/v1/labels/{z}/{x}/{y}"))
      .toBe("/__artifacts/tiles/v1/labels/{z}/{x}/{y}");
  });

  it("should map view scales onto the proxy-served zoom range", () => {
    expect(MIN_TILE_ZOOM).toBe(5);
    expect(MAX_TILE_ZOOM).toBe(18);
    expect(tileZoomForScale(100, 100)).toBe(14);
    expect(tileZoomForScale(200, 100)).toBe(15);
    expect(tileZoomForScale(50, 100)).toBe(13);
    expect(tileZoomForScale(1e12, 1)).toBe(18);
    expect(tileZoomForScale(1e-9, 1)).toBe(5);
    expect(tileZoomForScale(0, 100)).toBe(14);
    expect(tileZoomForScale(100, 0)).toBe(14);
  });

  it("should expose labels and attribution hooks with the same validation", () => {
    const map = stubMap();
    expect(map.getAttribution()).toEqual([]);
    expect(map.setAttribution("© Gouvernement du Québec")).toEqual(["© Gouvernement du Québec"]);
    expect(map.getAttribution()).toEqual(["© Gouvernement du Québec"]);
    expect(map.setAttribution(["a", "b"])).toEqual(["a", "b"]);
    expect(map.setAttribution(null)).toEqual([]);
    expect(map.getAttribution()).toEqual([]);
    expect(() => map.setAttribution(42)).toThrow();
    expect(() => map.setAttribution("")).toThrow();
    expect(() => map.setAttribution(["ok", ""])).toThrow();
    expect(() => map.setLabelsTemplate("//tiles.example.net/{z}/{x}/{y}")).toThrow();
    expect(() => map.setBasemapTemplate("//tiles.example.net/{z}/{x}/{y}")).toThrow();
    expect(() => createMap(stubContainer(), { labelsTemplate: "//tiles.example.net/{z}/{x}/{y}" })).toThrow();
    map.destroy();
    const withTemplates = createMap(stubContainer(), {
      basemapTemplate: "/__artifacts/tiles/v1/{z}/{x}/{y}",
      labelsTemplate: "/__artifacts/tiles/v1/labels/{z}/{x}/{y}",
    });
    withTemplates.destroy();
  });

  it("should expand templates and index standard XYZ tiles", () => {
    expect(expandTemplate("/t/{z}/{x}/{y}.png", 14, 4846, 6132)).toBe("/t/14/4846/6132.png");
    const [x, y] = tileXY(-73.512, 45.53, 14);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(2 ** 14);
    expect(y).toBeLessThan(2 ** 14);
    const [west, north] = tileToLonLat(x, y, 14);
    const [east, south] = tileToLonLat(x + 1, y + 1, 14);
    expect(west).toBeLessThanOrEqual(-73.512);
    expect(east).toBeGreaterThanOrEqual(-73.512);
    expect(south).toBeLessThanOrEqual(45.53);
    expect(north).toBeGreaterThanOrEqual(45.53);
    const tiles = tilesForBounds([[-73.52, 45.535], [-73.505, 45.525]], 14);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(64);
    expect(new Set(tiles.map(([tx, ty]) => `${tx}/${ty}`)).size).toBe(tiles.length);
  });
});

describe("map-base province tile budget", () => {
  const PROVINCE: Array<[number, number]> = [[-79.5, 45.0], [-57.0, 62.5]];
  const CITY: Array<[number, number]> = [[-73.55, 45.5], [-73.45, 45.6]];
  const WORLD: Array<[number, number]> = [[-180, -85], [180, 85]];

  it("should derive the zoom from ground resolution, not from the fit scale", () => {
    expect(MAX_TILES_PER_FRAME).toBe(96);
    expect(tileZoomForExtent(22.5, 1400)).toBe(6);
    expect(tileZoomForExtent(0.1, 800)).toBe(13);
    expect(tileZoomForExtent(360, 1400)).toBe(MIN_TILE_ZOOM);
    expect(tileZoomForExtent(1e-9, 1400)).toBe(MAX_TILE_ZOOM);
    expect(tileZoomForExtent(0, 1400)).toBe(MIN_TILE_ZOOM);
    expect(tileZoomForExtent(Number.NaN, 1400)).toBe(MIN_TILE_ZOOM);
    expect(tileZoomForExtent(22.5, 0)).toBe(MIN_TILE_ZOOM);
  });

  it("should serve a province extent at 1400px with at most 96 tiles at z<=8", () => {
    // The old fit-scale mapping would have enumerated this at z14.
    expect(countTilesForBounds(PROVINCE, FIT_Z)).toBeGreaterThan(MAX_TILES_PER_FRAME);
    const view = tilesForView(PROVINCE, 1400);
    expect(view.z).toBeLessThanOrEqual(8);
    expect(view.tiles.length).toBeGreaterThan(0);
    expect(view.tiles.length).toBeLessThanOrEqual(96);
    expect(view.tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_FRAME);
    expect(view.tiles.length).toBe(countTilesForBounds(PROVINCE, view.z));
  });

  it("should serve a city extent with z>=12", () => {
    const view = tilesForView(CITY, 800);
    expect(view.z).toBeGreaterThanOrEqual(12);
    expect(view.tiles.length).toBeGreaterThan(0);
    expect(view.tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_FRAME);
  });

  it("should hold the per-frame cap for any extent", () => {
    const world = tilesForView(WORLD, 1400);
    expect(world.z).toBe(MIN_TILE_ZOOM);
    expect(countTilesForBounds(WORLD, world.z)).toBeGreaterThan(MAX_TILES_PER_FRAME);
    expect(world.tiles).toEqual([]);
    for (const [corners, width] of [
      [PROVINCE, 1400],
      [CITY, 800],
      [WORLD, 1400],
      [CITY, 320],
    ] as const) {
      const view = tilesForView(corners as Array<[number, number]>, width);
      expect(view.tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_FRAME);
    }
  });

  it("should split the frame budget across layers in a dual-layer configuration", () => {
    expect(perLayerTileBudget(0)).toBe(MAX_TILES_PER_FRAME);
    expect(perLayerTileBudget(1)).toBe(MAX_TILES_PER_FRAME);
    expect(perLayerTileBudget(2)).toBe(MAX_TILES_PER_FRAME / 2);
    expect(perLayerTileBudget(2)).toBe(48);
    // Province at desktop width with base + labels: each layer enumerates
    // within its half, so the frame total stays within the budget.
    const perLayer = perLayerTileBudget(2);
    const view = tilesForView(PROVINCE, 1400, perLayer);
    expect(view.z).toBeLessThanOrEqual(8);
    expect(view.tiles.length).toBeGreaterThan(0);
    expect(view.tiles.length).toBeLessThanOrEqual(perLayer);
    expect(view.tiles.length * 2).toBeLessThanOrEqual(MAX_TILES_PER_FRAME);
  });

  it("should derive the zoom from the bitmap width (css x devicePixelRatio)", () => {
    const css = tilesForView(CITY, 800);
    const hidpi = tilesForView(CITY, 1600);
    expect(hidpi.z).toBe(css.z + 1);
    expect(hidpi.tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_FRAME);
    // The step-down absorbs any hidpi surplus at larger extents.
    const provinceHidpi = tilesForView(PROVINCE, 1400 * 2, perLayerTileBudget(1));
    expect(provinceHidpi.tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_FRAME);
  });
});

describe("map-base tile cache eviction", () => {
  it("should never evict a frame tile and drop oldest unneeded first", () => {
    expect(MAX_CACHED_TILES).toBe(256);
    const keys = ["a", "b", "c", "d"];
    const needed = new Set(["b", "d"]);
    expect(planTileEviction(keys, needed, 2)).toEqual(["a", "c"]);
    expect(planTileEviction(keys, needed, 10)).toEqual([]);
    // Every entry needed: nothing may go, even over capacity — the frame
    // holds at most MAX_TILES_PER_FRAME entries against the larger cache.
    expect(planTileEviction(keys, new Set(keys), 1)).toEqual([]);
    expect(planTileEviction(keys, new Set(), 2)).toEqual(["a", "b"]);
  });
});

interface StubDomCanvas {
  width: number;
  height: number;
  parentNode: null;
  listeners: Record<string, Array<(event: Record<string, unknown>) => void>>;
  setAttribute: () => void;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  getContext: () => Record<string, unknown>;
  addEventListener: (kind: string, callback: (event: Record<string, unknown>) => void) => void;
  removeEventListener: (kind: string, callback: (event: Record<string, unknown>) => void) => void;
}

function stubDomCanvas(): StubDomCanvas {
  const listeners: Record<string, Array<(event: Record<string, unknown>) => void>> = {};
  const context: Record<string, unknown> = {
    setTransform() {}, fillRect() {}, beginPath() {}, moveTo() {},
    lineTo() {}, closePath() {}, fill() {}, stroke() {}, drawImage() {},
  };
  return {
    width: 0,
    height: 0,
    parentNode: null,
    listeners,
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => context,
    addEventListener(kind, callback) {
      (listeners[kind] ??= []).push(callback);
    },
    removeEventListener(kind, callback) {
      listeners[kind] = (listeners[kind] ?? []).filter((entry) => entry !== callback);
    },
  };
}

function stubContainer() {
  const canvas = stubDomCanvas();
  return {
    canvas,
    appendChild() {},
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    ownerDocument: { createElement: () => canvas },
  };
}

function stubMap() {
  const map = createMap(stubContainer(), { basemapTemplate: null });
  map.setZones({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    }],
  });
  map.fitToBounds();
  return map;
}

describe("map-base zoom anchoring", () => {
  it("should keep the centre fixed across zoomIn and zoomOut", () => {
    const map = stubMap();
    const before = map.getView();
    map.zoomIn();
    const zoomed = map.getView();
    expect(zoomed.scale).toBeCloseTo(before.scale * 1.5, 9);
    expect(zoomed.cx).toBe(before.cx);
    expect(zoomed.cy).toBe(before.cy);
    map.zoomOut();
    const restored = map.getView();
    expect(restored.scale).toBeCloseTo(before.scale, 9);
    expect(restored.cx).toBe(before.cx);
    expect(restored.cy).toBe(before.cy);
    map.destroy();
  });

  it("should keep the geography under an off-centre wheel zoom fixed", () => {
    const container = stubContainer();
    const map = createMap(container, { basemapTemplate: null });
    map.setZones({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
      }],
    });
    map.fitToBounds();
    const probe = { clientX: 600, clientY: 200, preventDefault() {} };
    const clicks: Array<{ lon: number; lat: number }> = [];
    map.on("click", (payload: { lon: number; lat: number }) => {
      clicks.push({ lon: payload.lon, lat: payload.lat });
    });
    const wheel = container.canvas.listeners["wheel"];
    const click = container.canvas.listeners["click"];
    expect(wheel?.length).toBe(1);
    expect(click?.length).toBe(1);
    click![0]!(probe);
    wheel![0]!({ ...probe, deltaY: -100 });
    click![0]!(probe);
    expect(clicks).toHaveLength(2);
    expect(clicks[1]!.lon).toBeCloseTo(clicks[0]!.lon, 9);
    expect(clicks[1]!.lat).toBeCloseTo(clicks[0]!.lat, 9);
    map.destroy();
  });
});

describe("map-base tile loading", () => {
  class FakeImage {
    static instances: FakeImage[] = [];
    static srcEvents: string[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    srcValue = "";
    constructor() {
      FakeImage.instances.push(this);
    }
    get src(): string {
      return this.srcValue;
    }
    set src(value: string) {
      this.srcValue = value;
      FakeImage.srcEvents.push(value);
    }
    static reset(): void {
      FakeImage.instances = [];
      FakeImage.srcEvents = [];
    }
  }

  const globals = globalThis as unknown as Record<string, unknown>;
  const installImages = (): void => {
    FakeImage.reset();
    globals["Image"] = FakeImage;
  };
  const uninstallImages = (): void => {
    delete globals["Image"];
    delete globals["window"];
  };
  const setDevicePixelRatio = (ratio: number): void => {
    globals["window"] = { devicePixelRatio: ratio };
  };
  const requestedZooms = (): number[] =>
    FakeImage.srcEvents.filter((src) => src !== "").map((src) => Number(src.split("/")[2]));
  const cityCollection = () => ({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { NO_LOT: "CITY-1" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-73.55, 45.5], [-73.45, 45.5], [-73.45, 45.6], [-73.55, 45.6], [-73.55, 45.5]]],
      },
    }],
  });
  const farCollection = () => ({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { NO_LOT: "FAR-1" },
      geometry: {
        type: "Polygon",
        coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
      },
    }],
  });

  it("should really abort stale in-flight loads before issuing replacements", () => {
    installImages();
    try {
      const map = createMap(stubContainer(), { basemapTemplate: "/tiles/{z}/{x}/{y}" });
      map.setZones(cityCollection());
      map.fitToBounds();
      const firstFrame = [...FakeImage.instances];
      expect(firstFrame.length).toBeGreaterThan(0);
      map.setZones(farCollection());
      for (const image of firstFrame) {
        expect(image.onload).toBeNull();
        expect(image.onerror).toBeNull();
        expect(image.src).toBe("");
      }
      // Cancel-before-create: every abort lands before any replacement fetch.
      const lastAbort = FakeImage.srcEvents.lastIndexOf("");
      expect(lastAbort).toBeGreaterThanOrEqual(0);
      const after = FakeImage.srcEvents.slice(lastAbort + 1);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every((src) => src !== "")).toBe(true);
      map.destroy();
    } finally {
      uninstallImages();
    }
  });

  it("should abort in-flight loads on template change and destroy", () => {
    installImages();
    try {
      const map = createMap(stubContainer(), {
        basemapTemplate: "/tiles/{z}/{x}/{y}",
        labelsTemplate: "/labels/{z}/{x}/{y}",
      });
      map.setZones(cityCollection());
      map.fitToBounds();
      const firstFrame = [...FakeImage.instances];
      expect(firstFrame.length).toBeGreaterThan(0);
      map.setBasemapTemplate("/tiles-v2/{z}/{x}/{y}");
      for (const image of firstFrame) {
        expect(image.onload).toBeNull();
        expect(image.src).toBe("");
      }
      const secondFrame = FakeImage.instances.slice(firstFrame.length);
      expect(secondFrame.length).toBeGreaterThan(0);
      map.setLabelsTemplate("/labels-v2/{z}/{x}/{y}");
      for (const image of secondFrame) {
        expect(image.onload).toBeNull();
        expect(image.src).toBe("");
      }
      const thirdFrame = FakeImage.instances.slice(firstFrame.length + secondFrame.length);
      expect(thirdFrame.length).toBeGreaterThan(0);
      map.destroy();
      for (const image of thirdFrame) {
        expect(image.onload).toBeNull();
        expect(image.onerror).toBeNull();
        expect(image.src).toBe("");
      }
    } finally {
      uninstallImages();
    }
  });

  it("should keep settled tiles across frames instead of refetching", () => {
    installImages();
    try {
      const map = createMap(stubContainer(), { basemapTemplate: "/tiles/{z}/{x}/{y}" });
      map.setZones(cityCollection());
      map.fitToBounds();
      const settled = [...FakeImage.instances];
      expect(settled.length).toBeGreaterThan(0);
      for (const image of settled) image.onload?.();
      const count = FakeImage.instances.length;
      // Same-view frames (paint change, refit) reuse the settled entries.
      map.setPaint({ lots: { fill: "#ff0000" } });
      map.fitToBounds();
      expect(FakeImage.instances.length).toBe(count);
      for (const image of settled) expect(image.src).not.toBe("");
      map.destroy();
    } finally {
      uninstallImages();
    }
  });

  it("should retry failed tiles with bounded backoff then give up", () => {
    vi.useFakeTimers();
    try {
      installImages();
      try {
        expect(MAX_TILE_RETRIES).toBe(3);
        const map = createMap(stubContainer(), { basemapTemplate: "/tiles/{z}/{x}/{y}" });
        map.setZones(cityCollection());
        map.fitToBounds();
        const image = FakeImage.instances[0]!;
        const url = image.src;
        expect(url).not.toBe("");
        const attempts = (): number => FakeImage.srcEvents.filter((src) => src === url).length;
        // Each refetch fails again (like a browser refetch would), which
        // schedules the next attempt — until the bound is reached.
        image.onerror?.();
        expect(attempts()).toBe(1);
        vi.advanceTimersByTime(TILE_RETRY_BASE_MS + 50);
        expect(attempts()).toBe(2);
        image.onerror?.();
        vi.advanceTimersByTime(TILE_RETRY_BASE_MS * 2 + 100);
        expect(attempts()).toBe(3);
        image.onerror?.();
        vi.advanceTimersByTime(TILE_RETRY_BASE_MS * 4 + 200);
        expect(attempts()).toBe(4);
        image.onerror?.();
        vi.advanceTimersByTime(60000);
        expect(attempts()).toBe(4);
        // A detached entry is never retried.
        const doomed = FakeImage.instances[1]!;
        const doomedUrl = doomed.src;
        expect(doomedUrl).not.toBe("");
        doomed.onerror?.();
        map.setZones(farCollection());
        expect(doomed.src).toBe("");
        vi.advanceTimersByTime(60000);
        expect(FakeImage.srcEvents.filter((src) => src === doomedUrl).length).toBe(1);
        map.destroy();
      } finally {
        uninstallImages();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("should request one zoom level higher at devicePixelRatio 2", () => {
    installImages();
    try {
      setDevicePixelRatio(1);
      const first = createMap(stubContainer(), { basemapTemplate: "/tiles/{z}/{x}/{y}" });
      first.setZones(cityCollection());
      first.fitToBounds();
      const z1 = Math.max(...requestedZooms());
      expect(Number.isInteger(z1)).toBe(true);
      first.destroy();
      FakeImage.reset();
      setDevicePixelRatio(2);
      const second = createMap(stubContainer(), { basemapTemplate: "/tiles/{z}/{x}/{y}" });
      second.setZones(cityCollection());
      second.fitToBounds();
      const z2 = Math.max(...requestedZooms());
      expect(z2).toBe(z1 + 1);
      second.destroy();
    } finally {
      uninstallImages();
    }
  });
});

describe("map-base served bytes", () => {
  it("should match the pinned manifest digests and sizes exactly", () => {
    for (const asset of MAP_KIT_ASSETS) {
      const bytes = readFileSync(join(designAssets, asset.file), "utf8");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256Hex);
      expect(Buffer.byteLength(bytes)).toBe(asset.sizeBytes);
    }
  });

  it("should carry no worker, network, style-injection or personal-data surface", () => {
    const bundle = readFileSync(join(designAssets, "map-base.mjs"), "utf8");
    for (const forbidden of ["new Worker", "fetch(", "setAttribute(\"style\"", "<style",
      "adresse", "code_postal", "http://", "https://", ".style.", "eval(", "innerHTML"]) {
      expect(bundle, forbidden).not.toContain(forbidden);
    }
    const css = readFileSync(join(designAssets, "map-base.css"), "utf8");
    for (const forbidden of ["http://", "https://", "adresse"]) {
      expect(css, forbidden).not.toContain(forbidden);
    }
    expect(css).toContain(".map-base-attribution");
  });
});
