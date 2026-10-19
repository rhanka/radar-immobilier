import { describe, expect, it } from "vitest";
import { parseXml } from "./xml.js";
describe("XML nesting bounds", () => {
  it("rejects XML nesting beyond 64 levels", () => {
    const nested = (depth: number): string => "<a>".repeat(depth) + "<b/>" + "</a>".repeat(depth);
    expect(() => parseXml(nested(63))).not.toThrow();
    expect(() => parseXml("<a>".repeat(64) + "</a>".repeat(64))).not.toThrow();
    expect(() => parseXml(nested(64))).toThrow(/nesting exceeds/);
    expect(() => parseXml(nested(65))).toThrow(/nesting exceeds/);
  });


});
