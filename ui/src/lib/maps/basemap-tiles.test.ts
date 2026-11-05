import { describe, expect, it } from "vitest";
import { DEFAULT_BASEMAP_TILE_URL, basemapTileTemplate } from "./basemap-tiles.js";

describe("basemap tile template", () => {
  it("should resolve the OSM template by default (app build unchanged)", () => {
    expect(basemapTileTemplate({})).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(basemapTileTemplate({})).toBe(DEFAULT_BASEMAP_TILE_URL);
  });

  it("should resolve the same-origin relay when the artifact variable is set", () => {
    expect(
      basemapTileTemplate({ VITE_BASEMAP_TILE_URL: "/__artifacts/tiles/v1/osm/{z}/{x}/{y}" }),
    ).toBe("/__artifacts/tiles/v1/osm/{z}/{x}/{y}");
  });

  it("should ignore a blank override and keep the OSM default", () => {
    expect(basemapTileTemplate({ VITE_BASEMAP_TILE_URL: "   " })).toBe(DEFAULT_BASEMAP_TILE_URL);
  });
});
