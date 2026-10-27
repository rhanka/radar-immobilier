import { z } from "zod";
export type McpShape = Record<string, z.ZodType>;

function scalarError(expected: string, input: unknown): string {
  const received = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
  return input === undefined ? "Required" : `Expected ${expected}, received ${received}`;
}
export const mcpString = () => z.string({ error: (issue) => scalarError("string", issue.input) });
export const mcpBoolean = () => z.boolean({ error: (issue) => scalarError("boolean", issue.input) });
export const mcpNumber = () => z.number({ error: (issue) =>
  typeof issue.input === "number" && !Number.isFinite(issue.input)
    ? "Number must be finite" : scalarError("number", issue.input),
});
export const mcpBbox = () => z.tuple([mcpNumber(), mcpNumber(), mcpNumber(), mcpNumber()], {
  error: (issue) => issue.code === "too_small" ? "Array must contain at least 4 element(s)"
    : issue.code === "too_big" ? "Array must contain at most 4 element(s)"
      : scalarError("array", issue.input),
});

/** Keep v3's integer-first diagnostic order and finite unsafe integers. */
export function mcpIntegerField(options: {
  min?: number; max?: number; default?: number; description?: string; message?: string;
}): z.ZodType<number> {
  let base = mcpNumber().refine(Number.isInteger, {
    message: options.message ?? "Expected integer, received float",
  });
  if (options.min !== undefined) base = base.min(options.min, {
    error: `Number must be greater than or equal to ${options.min}`,
  });
  if (options.max !== undefined) base = base.max(options.max, {
    error: `Number must be less than or equal to ${options.max}`,
  });
  let result: z.ZodType<number> = base;
  if (options.default !== undefined) result = result.default(options.default);
  if (options.description !== undefined) result = result.describe(options.description);
  return result;
}

export function mcpFinitePositiveField(options: { optional?: boolean; description?: string }) {
  const base = mcpNumber().positive({ error: "Number must be greater than 0" });
  const described = options.description ? base.describe(options.description) : base;
  return options.optional ? described.optional() : described;
}
