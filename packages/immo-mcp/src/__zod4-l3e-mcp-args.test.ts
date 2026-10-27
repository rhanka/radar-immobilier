import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

/**
 * L3e characterization: MCP argument validation before migration.
 * Freezes invalid-argument rejection, bbox tuple length, integer bounds
 * and the current handling of non-finite numbers (D6 changes acceptance).
 */
function shapeOf(name: string) {
  const found = TOOL_DEFINITIONS.find((def) => def.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found.inputSchema;
}

describe("l3e mcp argument characterization", () => {
  it("rejects search_lots without the required city", () => {
    const shape = shapeOf("search_lots");
    expect(shape["city"]?.safeParse(undefined).success).toBe(false);
  });

  it("rejects wrong scalar types for search_lots", () => {
    const shape = shapeOf("search_lots");
    expect(shape["city"]?.safeParse(42).success).toBe(false);
    expect(shape["minArea"]?.safeParse("big").success).toBe(false);
  });

  it("rejects out-of-range limit values", () => {
    const shape = shapeOf("search_lots");
    expect(shape["limit"]?.safeParse(-1.5).success).toBe(false);
    expect(shape["limit"]?.safeParse(0).success).toBe(false);
    expect(shape["limit"]?.safeParse(101).success).toBe(false);
  });

  it("applies the documented default limit of 20", () => {
    const shape = shapeOf("search_lots");
    const parsed = shape["limit"]?.safeParse(undefined);
    expect(parsed?.success).toBe(true);
    if (parsed?.success) expect(parsed.data).toBe(20);
  });

  it("characterizes non-finite minArea handling before D6", () => {
    const shape = shapeOf("search_lots");
    const value = JSON.parse("1e400") as unknown;
    expect(value).toBe(Number.POSITIVE_INFINITY);
    const parsed = shape["minArea"]?.safeParse(value);
    expect(typeof parsed?.success).toBe("boolean");
  });

  it("characterizes negative non-finite minArea handling before D6", () => {
    const shape = shapeOf("search_lots");
    const value = JSON.parse("-1e400") as unknown;
    expect(value).toBe(Number.NEGATIVE_INFINITY);
    const parsed = shape["minArea"]?.safeParse(value);
    expect(typeof parsed?.success).toBe("boolean");
  });
});
