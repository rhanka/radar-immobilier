import { describe, expect, it } from "vitest";
import {
  MAP_KIT_ASSETS,
  MAP_KIT_VERSION,
  findMapKitAsset,
  mapKitAssetUrl,
} from "./map-kit.js";

describe("map-kit manifest", () => {
  it("should pin the map kit version with sha256 assets outside the publication budget", () => {
    expect(MAP_KIT_VERSION).toBe("map-v1");
    expect(MAP_KIT_ASSETS.map((asset) => asset.file)).toEqual(["map-base.mjs", "map-base.css"]);
    for (const asset of MAP_KIT_ASSETS) {
      expect(asset.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.sizeBytes).toBeGreaterThan(0);
      expect(mapKitAssetUrl(asset))
        .toBe(`/__artifacts/design/${MAP_KIT_VERSION}/${asset.sha256Hex}/${asset.file}`);
    }
    expect(Object.isFrozen(MAP_KIT_ASSETS)).toBe(true);
  });

  it("should serve ESM with the JavaScript media type and CSS with the CSS media type", () => {
    const byFile = new Map(MAP_KIT_ASSETS.map((asset) => [asset.file, asset]));
    expect(byFile.get("map-base.mjs")!.mediaType).toBe("text/javascript");
    expect(byFile.get("map-base.css")!.mediaType).toBe("text/css");
  });

  it("should resolve only the closed asset list with matching digests", () => {
    const [first] = MAP_KIT_ASSETS;
    expect(findMapKitAsset(MAP_KIT_VERSION, first!.sha256Hex, first!.file)).toEqual(first);
    expect(findMapKitAsset("map-v9", first!.sha256Hex, first!.file)).toBeNull();
    expect(findMapKitAsset(MAP_KIT_VERSION, "0".repeat(64), first!.file)).toBeNull();
    expect(findMapKitAsset(MAP_KIT_VERSION, first!.sha256Hex, "other.mjs")).toBeNull();
    expect(findMapKitAsset(MAP_KIT_VERSION, "not-a-digest", first!.file)).toBeNull();
    // Digests are lowercase hex by convention, like the CSS kit: uppercase
    // input is refused rather than normalized.
    expect(findMapKitAsset(MAP_KIT_VERSION, first!.sha256Hex.toUpperCase(), first!.file)).toBeNull();
    expect(findMapKitAsset(MAP_KIT_VERSION, first!.sha256Hex, "../map-base.mjs")).toBeNull();
    expect(findMapKitAsset(MAP_KIT_VERSION, first!.sha256Hex, "map-base.mjs?x=1")).toBeNull();
  });
});
