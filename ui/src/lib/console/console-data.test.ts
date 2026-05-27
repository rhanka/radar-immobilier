import { describe, expect, it } from "vitest";
import { sourceEvaluations } from "../source-review/source-evaluation-data.js";
import { qualificationStatus } from "./console-data.js";

describe("qualificationStatus", () => {
  it("returns at least one row", () => {
    const rows = qualificationStatus();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("first row is build-now", () => {
    const rows = qualificationStatus();
    expect(rows[0].recommendation).toBe("build-now");
  });

  it("counts sum to sourceEvaluations.length", () => {
    const rows = qualificationStatus();
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(sourceEvaluations.length);
  });

  it("returns a row per recommendation group present in catalogue", () => {
    const rows = qualificationStatus();
    const presentRecs = new Set(sourceEvaluations.map((s) => s.recommendation));
    expect(rows).toHaveLength(presentRecs.size);
    for (const rec of presentRecs) {
      expect(rows.some((r) => r.recommendation === rec)).toBe(true);
    }
  });

  it("each row has a non-empty French label", () => {
    const rows = qualificationStatus();
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
    }
  });

  it("each row has a positive count", () => {
    const rows = qualificationStatus();
    for (const row of rows) {
      expect(row.count).toBeGreaterThan(0);
    }
  });
});
