import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toContractDetails, toErrorTree } from "@radar/domain";
import { validateLotMetaField } from "./prospect-marks-lotmeta.js";

describe("l5 validation dto mapping", () => {
  it("maps invalid_format back to historic invalid_string", () => {
    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse({ email: "not-an-email" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const details = toContractDetails(parsed.error.issues);
      expect(details[0]?.code).toBe("invalid_string");
      expect(details[0]?.path).toEqual(["email"]);
    }
  });

  it("builds the historic _errors tree", () => {
    const tree = toErrorTree([
      { code: "invalid_string", path: ["email"], message: "bad" },
      { code: "too_small", path: ["limit"], message: "small" },
    ]);
    expect(tree).toMatchObject({ _errors: [], "email": { _errors: ["bad"] } });
  });

  it("bounds lotMeta reconstruction on many bad entries", () => {
    for (const size of [31, 32, 33, 10_000]) {
      const lotMeta: Record<string, unknown> = {};
      for (let index = 0; index < size; index += 1) lotMeta[`bad-${index}`] = { noLot: "", citySlug: "" };
      Object.defineProperty(lotMeta, "__proto__", { value: { noLot: "ok", citySlug: "ok" }, enumerable: true, configurable: true });
      const checked = validateLotMetaField(lotMeta);
      expect(checked.ok).toBe(false);
      expect(checked.details).toHaveLength(Math.min(size, 32) * 3 + (size < 32 ? 1 : 0));
    }
  });

  it("rejects non-finite prixDemande through the finite helper", async () => {
    const { finitePositiveOptional } = await import("./finite-number.js");
    const schema = z.object({ prixDemande: finitePositiveOptional() });
    expect(schema.safeParse({ prixDemande: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(schema.safeParse({ prixDemande: 450000 }).success).toBe(true);
  });
});
