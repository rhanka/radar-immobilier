import { describe, expect, it } from "vitest";
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import { convertInputShape, normalizeToolJsonSchema } from "./zod4-jsonschema.js";

function shapeOf(name: string) {
  const found = ALL_TOOL_DEFINITIONS.find((def) => def.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found.inputSchema;
}

describe("l6 mcp integer and normalization", () => {
  it("reports both integer and bound issues for limit -1.5", () => {
    const shape = shapeOf("search_lots");
    const parsed = shape["limit"]?.safeParse(-1.5);
    expect(parsed?.success).toBe(false);
    if (!parsed?.success) expect(parsed.error.issues.map((issue) => issue.message)).toEqual([
      "Expected integer, received float", "Number must be greater than or equal to 1",
    ]);
  });

  it("keeps integer acceptance for boundary values", () => {
    const shape = shapeOf("search_lots");
    expect(shape["limit"]?.safeParse(1).success).toBe(true);
    expect(shape["limit"]?.safeParse(100).success).toBe(true);
    expect(shape["limit"]?.safeParse(0).success).toBe(false);
  });

  it("keeps omission defaulting to 20 without handler input", () => {
    const shape = shapeOf("search_lots");
    const parsed = shape["limit"]?.safeParse(undefined);
    expect(parsed?.success).toBe(true);
    if (parsed?.success) expect(parsed.data).toBe(20);
  });

  it("normalizes root additionalProperties and bbox additionalItems", () => {
    const converted = convertInputShape(shapeOf("get_lots_geojson"));
    const normalized = normalizeToolJsonSchema("get_lots_geojson", converted);
    expect(normalized.additionalProperties).toBe(false);
    const bbox = (normalized.properties as Record<string, Record<string, unknown>>)?.["bbox"];
    expect(bbox?.["additionalItems"]).toBeUndefined();
  });

  it("keeps read offset without a published maximum", () => {
    const converted = convertInputShape(shapeOf("read_document_excerpt"));
    const normalized = normalizeToolJsonSchema("read_document_excerpt", converted);
    const offset = (normalized.properties as Record<string, Record<string, unknown>>)?.["offset"];
    expect(offset?.["maximum"]).toBeUndefined();
    expect(offset?.["exclusiveMaximum"]).toBeUndefined();
  });
});
