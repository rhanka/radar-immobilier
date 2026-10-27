import { z } from "zod";
import type { McpShape } from "./zod4-shapes.js";
export interface NormalizedJsonSchema {
  properties?: Record<string, Record<string, unknown>>;
  additionalProperties?: boolean;
  [key: string]: unknown;
}
export function convertInputShape(shape: McpShape): NormalizedJsonSchema {
  return z.toJSONSchema(z.object(shape), { target: "draft-7", io: "input" }) as NormalizedJsonSchema;
}

/** Publish the same draft-7 input contract captured from the Zod 3 server. */
export function normalizeToolJsonSchema(_toolName: string, schema: NormalizedJsonSchema): NormalizedJsonSchema {
  const properties = { ...schema.properties };
  for (const key of ["limit", "offset", "maxChars"]) {
    if (properties[key]) properties[key] = { ...properties[key], type: "integer" };
  }
  if (properties.bbox) {
    const { additionalItems: _additionalItems, ...bbox } = properties.bbox;
    properties.bbox = bbox;
  }
  return { ...schema, properties, additionalProperties: false };
}
