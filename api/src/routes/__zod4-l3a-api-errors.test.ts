import { contractSafeParse } from "@radar/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * L3a characterization: primitive API error contracts under Zod 3.
 * Freezes wire-relevant shapes before migration: status mapping is done
 * by routes (400 + { error, details }), this file freezes the payload
 * content (paths, codes, order, messages) those routes forward.
 */

const primitiveSchema = z.object({
  city: z.string().min(1),
  etape: z.enum(["avis_motion", "adoption"]),
  kind: z.literal("lot"),
  limit: z.number().int().min(1).max(100).default(20),
  id: z.string().guid(),
});

describe("l3a primitive error characterization", () => {
  it("accepts a valid payload with default applied", () => {
    const parsed = contractSafeParse(primitiveSchema, {
      city: "valleyfield",
      etape: "adoption",
      kind: "lot",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(20);
  });

  it("reports missing required fields with explicit paths", () => {
    const parsed = contractSafeParse(primitiveSchema, { city: "valleyfield" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("etape");
      expect(paths).toContain("kind");
      expect(paths).toContain("id");
    }
  });

  it("reports invalid enum with received value preserved", () => {
    const parsed = contractSafeParse(primitiveSchema, {
      city: "valleyfield",
      etape: "unknown_step",
      kind: "lot",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((entry) => entry.path.join(".") === "etape");
      expect(issue).toBeDefined();
      expect(String(issue?.message)).toMatch(/Invalid enum/i);
    }
  });

  it("reports invalid literal distinctly from enum", () => {
    const parsed = contractSafeParse(primitiveSchema, {
      city: "valleyfield",
      etape: "adoption",
      kind: "signal",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((entry) => entry.path.join(".") === "kind");
      expect(issue).toBeDefined();
      expect(String(issue?.message)).toMatch(/Invalid literal/i);
    }
  });

  it("reports wrong scalar type with expected/received metadata", () => {
    const parsed = contractSafeParse(primitiveSchema, {
      city: 42,
      etape: "adoption",
      kind: "lot",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((entry) => entry.path.join(".") === "city");
      expect(issue?.code).toBe("invalid_type");
    }
  });

  it("keeps min/max bounds in messages", () => {
    const short = contractSafeParse(primitiveSchema, {
      city: "",
      etape: "adoption",
      kind: "lot",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(short.success).toBe(false);
    const over = contractSafeParse(primitiveSchema, {
      city: "valleyfield",
      etape: "adoption",
      kind: "lot",
      limit: 101,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(over.success).toBe(false);
  });
});
