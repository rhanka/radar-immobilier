/**
 * GH #817 — declared-mode termination summary: valid JSON within the 4 000-byte
 * budget of the termination message (UTF-8 bytes, review ASTRA-853-R2-01).
 */
import { describe, expect, it } from "vitest";

import { declaredTerminationSummary, TERMINATION_MAX_BYTES } from "./projection-termination.js";

const report = { event: "project-graph-from-s3:report", ok: 0, aborted: 1, skipped: 0, errors: 0, total: 1,
  deletedNodes: 0, deletedEdges: 0, deletedStaleEdges: 0, abortedCities: ["brigham"] };
const ids = Array.from({ length: 21 }, (_, i) => `node-${i}`);

describe("declaredTerminationSummary", () => {
  it("keeps the full brigham plan", () => {
    const body = declaredTerminationSummary(report, true, {
      plannedRemovals: ids, plannedLosses: ["muni-brigham:flag"], declaredNotInPlan: [], undeclaredRemovals: [],
    });
    const parsed = JSON.parse(body);
    expect(parsed.preview).toBe(true);
    expect(parsed.declared.plannedRemovals).toEqual(ids);
    expect(parsed.declared.plannedLosses).toEqual(["muni-brigham:flag"]);
  });

  it("stays within the byte budget with multi-byte property keys in the plan", () => {
    const losses = Array.from({ length: 40 }, (_, i) => `muni:${"é".repeat(60)}${i}`);
    const body = declaredTerminationSummary(report, false, {
      plannedRemovals: ids, plannedLosses: losses, declaredNotInPlan: [], undeclaredRemovals: [],
    });
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(TERMINATION_MAX_BYTES);
    const parsed = JSON.parse(body);
    expect(parsed.declared.plannedLosses.at(-1)).toMatch(/^…\+\d+$/);
  });

  it("falls back to a bounded valid JSON when even empty lists do not fit", () => {
    const huge = ["x".repeat(5000)];
    const body = declaredTerminationSummary(report, false, {
      plannedRemovals: huge, plannedLosses: [], declaredNotInPlan: [], undeclaredRemovals: [],
    });
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(TERMINATION_MAX_BYTES);
    expect(JSON.parse(body).declared.plannedRemovals).toEqual(["…+1"]);
  });

  it("reports a city that was never projected", () => {
    expect(JSON.parse(declaredTerminationSummary(report, true, undefined)).declared).toBeNull();
  });
});
