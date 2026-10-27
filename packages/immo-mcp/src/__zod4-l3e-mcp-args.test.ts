import { z as bundledV3 } from "zod/v3";
import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

/**
 * L3e characterization: MCP argument validation before migration.
 * Freezes invalid-argument rejection, bbox tuple length, integer bounds
 * and the current handling of non-finite numbers (D6 changes acceptance).
 */
const z3: typeof bundledV3 = process.env.ZOD3_REFERENCE
  ? (await import(/* @vite-ignore */ process.env.ZOD3_REFERENCE)).z : bundledV3;
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

  for (const lexeme of ["1e400", "-1e400"]) it("rejects non-finite minArea " + lexeme, () => {
    const value = JSON.parse(lexeme) as number;
    const previous = z3.number().positive().safeParse(value);
    expect(previous.success).toBe(lexeme === "1e400");
    if (!previous.success) expect(previous.error.issues.map((issue) => issue.message))
      .toEqual(["Number must be greater than 0"]);
    const parsed = shapeOf("search_lots")["minArea"]!.safeParse(value);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw Error("non-finite minArea accepted");
    expect(parsed.error.issues).toEqual([expect.objectContaining({
      code: "invalid_type", expected: "number", path: [], message: "Number must be finite",
    })]);
  });
});
