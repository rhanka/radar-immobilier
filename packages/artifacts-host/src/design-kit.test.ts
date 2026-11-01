import { describe, expect, it } from "vitest";
import {
  DESIGN_KIT_ASSETS,
  DESIGN_KIT_VERSION,
  designKitAssetUrl,
  findDesignKitAsset,
} from "./design-kit.js";

describe("design-kit manifest", () => {
  it("should pin the official kit version with sha256 assets outside the publication budget", () => {
    expect(DESIGN_KIT_VERSION).toBe("ds-0.36.46-r1");
    expect(DESIGN_KIT_ASSETS.map((asset) => asset.file)).toEqual(["sent-tech.css", "components.css"]);
    for (const asset of DESIGN_KIT_ASSETS) {
      expect(asset.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.mediaType).toBe("text/css");
      expect(asset.sizeBytes).toBeGreaterThan(0);
      expect(designKitAssetUrl(asset))
        .toBe(`/__artifacts/design/${DESIGN_KIT_VERSION}/${asset.sha256Hex}/${asset.file}`);
    }
    expect(Object.isFrozen(DESIGN_KIT_ASSETS)).toBe(true);
  });

  it("should resolve only the closed asset list with matching digests", () => {
    const [first] = DESIGN_KIT_ASSETS;
    expect(findDesignKitAsset(DESIGN_KIT_VERSION, first!.sha256Hex, first!.file)).toEqual(first);
    expect(findDesignKitAsset("ds-0.00.00-r9", first!.sha256Hex, first!.file)).toBeNull();
    expect(findDesignKitAsset(DESIGN_KIT_VERSION, "0".repeat(64), first!.file)).toBeNull();
    expect(findDesignKitAsset(DESIGN_KIT_VERSION, first!.sha256Hex, "other.css")).toBeNull();
    expect(findDesignKitAsset(DESIGN_KIT_VERSION, "not-a-digest", first!.file)).toBeNull();
    expect(findDesignKitAsset(DESIGN_KIT_VERSION, first!.sha256Hex, "../sent-tech.css")).toBeNull();
    expect(findDesignKitAsset(DESIGN_KIT_VERSION, first!.sha256Hex, "sent-tech.css?x=1")).toBeNull();
  });
});
