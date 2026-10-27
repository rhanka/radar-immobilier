import { describe, expect, it } from "vitest";
import { z } from "zod";
import { z as bundledV3 } from "zod/v3";
import { ScrapeStatus, isoDateTimeSchema } from "../schemas/index.js";
import { contractSafeParse } from "./validation-dto.js";

const z3: typeof bundledV3 = process.env.ZOD3_REFERENCE
  ? (await import(/* @vite-ignore */ process.env.ZOD3_REFERENCE)).z : bundledV3;
function comparable(result: { success: true; data: unknown }
  | { success: false; error: { issues: readonly unknown[] } }) {
  return result.success ? { data: result.data } : { issues: result.error.issues };
}
const utc = ["2026-10-27T12:30Z", "2024-02-29T00:00Z",
  "2026-10-27T12:30:00Z", "2026-10-27T12:30:00.123Z",
  "2026-02-29T12:30Z", "2026-04-31T12:30Z", "2026-10-27T24:00Z",
  "2026-10-27T12:60Z", "2026-10-27T12:30:60Z", "2026-10-27T12:30",
  "2026-10-27T12:30+04:00", "2026-10-27", "invalid"];
describe("Astra domain parity against Zod 3", () => {
  for (const value of utc) it("preserves UTC datetime " + value, () => {
    const expected = comparable(z3.string().datetime().safeParse(value));
    for (const schema of [isoDateTimeSchema, ScrapeStatus.shape.lastRunAt]) {
      expect(comparable(contractSafeParse(schema, value))).toEqual(expected);
    }
  });
  for (const value of [-1.5, 0.5, 0, 1, 6, 2 ** 53, 1e20, -1e20, "6", null]) {
    it("preserves integer diagnostics and finite range " + String(value), () => {
      expect(comparable(contractSafeParse(ScrapeStatus.shape.windowMonths, value))).toEqual(
        comparable(z3.number().int().positive().default(6).safeParse(value)));
    });
  }
  const nonnumeric = [
    [z.string(), z3.string()], [z.boolean(), z3.boolean()],
    [z.object({}), z3.object({})], [z.array(z.string()), z3.array(z3.string())],
  ] as const;
  for (const [index, [current, previous]] of nonnumeric.entries()) {
    for (const lexeme of ["1e400", "-1e400"]) it("retains nonnumeric type metadata " + index + "/" + lexeme, () => {
      const input = JSON.parse(lexeme) as unknown;
      expect(comparable(contractSafeParse(current, input))).toEqual(comparable(previous.safeParse(input)));
    });
  }
});
