import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeQuery, SignalQuery } from "./classification-query.js";
import { ClassificationError } from "./classification-errors.js";

function invalidQuery(params: string, schema: z.ZodTypeAny = SignalQuery): string {
  try {
    decodeQuery(new URLSearchParams(params), schema);
  } catch (error) {
    expect(error).toBeInstanceOf(ClassificationError);
    return (error as ClassificationError).code;
  }
  expect.fail(`Expected invalid_query for ${params}`);
}

describe("strict classification query decoding", () => {
  it("should reject a repeated __proto__ parameter as an invalid query", () => {
    expect(invalidQuery("__proto__=a&__proto__=b", z.object({}).strict())).toBe("invalid_query");
  });
  it("should reject a single unknown __proto__ parameter as an invalid query", () => {
    expect(invalidQuery("__proto__=x", z.object({}).strict())).toBe("invalid_query");
  });
  it("should reject unknown and repeated parameters on the facet-context schema", () => {
    expect(invalidQuery("unknown=1", z.object({}).strict())).toBe("invalid_query");
    expect(invalidQuery("a=1&a=2", z.object({}).strict())).toBe("invalid_query");
  });
  it("should keep valid signal queries accepted", () => {
    const query = decodeQuery(new URLSearchParams("citySlug=synthetic-city&limit=20"), SignalQuery);
    expect(query.citySlug).toBe("synthetic-city");
    expect(query.limit).toBe(20);
  });
});
