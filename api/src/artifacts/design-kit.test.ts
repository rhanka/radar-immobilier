import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DESIGN_KIT_ASSETS } from "@radar/artifacts-host";
import { APPROVAL_STYLE, APPROVAL_STYLE_HASH, approvalStylesheetLinks } from "./reader-opening.js";
import { DESIGN_KIT_CSS_MIME, getDesignKitCss } from "./design-kit.js";

describe("design-kit serving bytes", () => {
  it("should serve vendored bytes that match the pinned manifest digests", () => {
    expect(DESIGN_KIT_CSS_MIME).toBe("text/css; charset=utf-8");
    for (const asset of DESIGN_KIT_ASSETS) {
      const css = getDesignKitCss(asset);
      expect(createHash("sha256").update(css, "utf8").digest("hex")).toBe(asset.sha256Hex);
      expect(Buffer.byteLength(css, "utf8")).toBe(asset.sizeBytes);
      expect(css).toContain("--st-");
    }
  });

  it("should allow-list the exact approval style bytes in the CSP hash", () => {
    const digest = createHash("sha256").update(APPROVAL_STYLE, "utf8").digest("base64");
    expect(APPROVAL_STYLE_HASH).toBe(`sha256-${digest}`);
    expect(APPROVAL_STYLE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const links = approvalStylesheetLinks();
    for (const asset of DESIGN_KIT_ASSETS) {
      expect(links).toContain(`/__artifacts/design/`);
      expect(links).toContain(asset.sha256Hex);
      expect(links).toContain(asset.file);
    }
  });
});
