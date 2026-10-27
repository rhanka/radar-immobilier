import { describe, expect, it } from "vitest";
import { batchMarkSchema } from "./prospect-marks.js";
import { lotBatchSchema, lotMutationSchema } from "./scoped-lot-facets-common.js";
import { dispositionsBodySchema } from "./scoped-lot-cutover-activation.js";
import { contractSafeParse } from "@radar/domain";

/** Frozen budgets: 250 ms validation+DTO, 16 MiB RSS growth, 8 KiB diagnostics. */
const cases = [
  ["lotVersionIds", batchMarkSchema, (items: unknown[]) => ({
    lotVersionIds: items, lotMeta: {}, dimension: "pipeline", statut: "favori",
  }), 501],
  ["items", lotBatchSchema, (items: unknown[]) => ({ items, mode: "real" }), 501],
  ["deselect", lotMutationSchema, (deselect: unknown[]) => ({ action: "discard", deselect, reasonCode: "TEST" }), 9],
  ["decisions", dispositionsBodySchema, (decisions: unknown[]) => ({ manifestSha: "a".repeat(64), decisions }), 201],
] as const;
describe("Zod constrained arrays reject size before child traversal", () => {
  for (const [field, schema, build, excess] of cases) {
    for (const size of [excess, 10_000, 100_000]) it(`${field} at ${size}`, () => {
      const values = Array<unknown>(size).fill(null);
      Object.defineProperty(values, 0, { get() { throw new Error("oversized child traversed"); } });
      const input = build(values);
      const before = process.memoryUsage().rss;
      const start = performance.now();
      const result = contractSafeParse(schema, input);
      const elapsed = performance.now() - start;
      const rssGrowth = Math.max(0, process.memoryUsage().rss - before);
      expect(result.success).toBe(false);
      if (result.success) throw new Error("oversized array accepted");
      const issues = result.error.issues.filter((issue) => issue.path[0] === field);
      expect(result.error.issues).toHaveLength(1);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe("too_big");
      expect(issues[0]?.path).toEqual([field]);
      expect(elapsed).toBeLessThanOrEqual(250);
      expect(rssGrowth).toBeLessThanOrEqual(16 * 1024 * 1024);
      expect(Buffer.byteLength(JSON.stringify(result.error.issues))).toBeLessThanOrEqual(8192);
      console.info(JSON.stringify({ field, size, elapsedMs: elapsed, rssGrowth, issues: issues.length }));
    });
  }
});
