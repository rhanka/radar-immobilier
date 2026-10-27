import { describe, expect, it } from "vitest";
import { z as bundledV3 } from "zod/v3";
import { contractSafeParse } from "@radar/domain";
import { ListingUrlSchema } from "./wire-schemas.js";

const z3: typeof bundledV3 = process.env.ZOD3_REFERENCE
  ? (await import(/* @vite-ignore */ process.env.ZOD3_REFERENCE)).z : bundledV3;
const previous = z3.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol)
    && !url.username && !url.password && !/\s/.test(value);
}, "Public HTTP(S) URL required").nullable();
describe("Astra listing URLs are checked before normalization", () => {
  for (const value of [" https://a.test/a", "https://a.test/a ", "\thttps://a.test/a",
    "https://a.test/a\tb", "https://a.test/a\rb", "https://a.test/a\nb",
    "https://a.test/a b", "https://a.test/a", "https://a.test/a%20b",
    "HTTPS://A.TEST/a", "https://user:password@a.test/a", "javascript:alert(1)", null]) {
    it("matches Zod 3 on raw URL " + JSON.stringify(value), () => {
      const expected = previous.safeParse(value);
      const actual = contractSafeParse(ListingUrlSchema, value);
      expect(actual.success).toBe(expected.success);
      if (expected.success && actual.success) expect(actual.data).toEqual(expected.data);
      else if (!expected.success && !actual.success) expect(actual.error.issues).toEqual(expected.error.issues);
    });
  }
});
