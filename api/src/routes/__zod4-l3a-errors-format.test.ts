import { contractSafeParse } from "@radar/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * L3a part 2: strict stripping, _errors format, unions and discriminants.
 * Freezes the shapes routes expose via `parsed.error.issues` (details)
 * and `parsed.error.format()` (_errors root/fields).
 */

const strictSchema = z
  .object({ city: z.string().min(1), limit: z.number().int().default(20) })
  .strict();
const plainSchema = z.object({ city: z.string().min(1) });

describe("l3a strict and _errors characterization", () => {
  it("strict objects reject unknown keys with unrecognized_keys", () => {
    const parsed = contractSafeParse(strictSchema, { city: "valleyfield", extra: 1 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("plain objects strip unknown keys and succeed", () => {
    const parsed = contractSafeParse(plainSchema, { city: "valleyfield", extra: 1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ city: "valleyfield" });
  });

  it("format() exposes root _errors and per-field _errors", () => {
    const schema = z.object({ email: z.string().email(), note: z.string().min(1).optional() });
    const parsed = contractSafeParse(schema, { email: "not-an-email" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const formatted = parsed.error.format() as {
        _errors: string[];
        email?: { _errors: string[] };
      };
      expect(Array.isArray(formatted._errors)).toBe(true);
      expect(formatted.email?._errors.length).toBeGreaterThan(0);
    }
  });

  it("unions report all branches on no match", () => {
    const schema = z.union([z.string().min(5), z.number().int().positive()]);
    const parsed = contractSafeParse(schema, "abc");
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.length).toBeGreaterThan(0);
  });

  it("discriminated unions reject unknown discriminant values", () => {
    const schema = z.discriminatedUnion("target_type", [
      z.object({ target_type: z.literal("lot"), no_lot: z.string().min(1) }),
      z.object({ target_type: z.literal("signal"), signal_id: z.string().guid() }),
    ]);
    const parsed = contractSafeParse(schema, { target_type: "parcel", no_lot: "1" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["target_type"]);
    }
  });

  it("accumulates simultaneous errors in input order", () => {
    const schema = z.object({ a: z.string().min(5), b: z.number().int() });
    const parsed = contractSafeParse(schema, { a: "x", b: "not-a-number" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join("."))).toEqual(["a", "b"]);
    }
  });
});
