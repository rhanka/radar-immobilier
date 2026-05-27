import { describe, expect, it } from "vitest";
import {
  countsByStatus,
  demoJobs,
  filterJobsByMode,
} from "$lib/jobs/jobs-data.js";
import { qualificationStatus } from "$lib/console/console-data.js";
import { sourceEvaluations } from "$lib/source-review/source-evaluation-data.js";

// ── Jobs helpers ────────────────────────────────────────────────────────────

describe("countsByStatus — ConsoleView contract", () => {
  it("sums to demoJobs.length", () => {
    const counts = countsByStatus(demoJobs);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(demoJobs.length);
  });

  it("all 4 status keys present", () => {
    const counts = countsByStatus(demoJobs);
    expect(Object.keys(counts).sort()).toEqual(
      ["done", "failed", "queued", "running"].sort(),
    );
  });

  it("counts are non-negative", () => {
    const counts = countsByStatus(demoJobs);
    for (const v of Object.values(counts)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("filterJobsByMode — ConsoleView contract", () => {
  it('mode="real" length is strictly less than total (demo has simulation rows)', () => {
    const real = filterJobsByMode(demoJobs, "real");
    expect(real.length).toBeLessThan(demoJobs.length);
    expect(real.length).toBeGreaterThan(0);
  });

  it('mode="real" drops all simulation jobs', () => {
    const real = filterJobsByMode(demoJobs, "real");
    expect(real.every((j) => j.mode !== "simulation")).toBe(true);
  });

  it('mode="simulation" keeps full list', () => {
    const all = filterJobsByMode(demoJobs, "simulation");
    expect(all).toHaveLength(demoJobs.length);
  });

  it("real-mode jobs are exactly the real-mode subset", () => {
    const real = filterJobsByMode(demoJobs, "real");
    const expected = demoJobs.filter((j) => j.mode === "real").length;
    expect(real.length).toBe(expected);
  });

  it("countsByStatus applied to real-only sums correctly", () => {
    const real = filterJobsByMode(demoJobs, "real");
    const counts = countsByStatus(real);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(real.length);
  });
});

// ── Console data helper ─────────────────────────────────────────────────────

describe("qualificationStatus — ConsoleView contract", () => {
  it("counts sum covers the entire catalogue", () => {
    const rows = qualificationStatus();
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(sourceEvaluations.length);
  });

  it("returns a row for every recommendation kind present in catalogue", () => {
    const rows = qualificationStatus();
    const presentRecs = new Set(sourceEvaluations.map((s) => s.recommendation));
    for (const rec of presentRecs) {
      expect(rows.some((r) => r.recommendation === rec)).toBe(true);
    }
  });

  it("no row has a zero count (only populated groups)", () => {
    const rows = qualificationStatus();
    for (const row of rows) {
      expect(row.count).toBeGreaterThan(0);
    }
  });

  it("first row is build-now (highest-priority group)", () => {
    const rows = qualificationStatus();
    expect(rows[0].recommendation).toBe("build-now");
  });

  it("each row label is a non-empty string", () => {
    const rows = qualificationStatus();
    for (const row of rows) {
      expect(typeof row.label).toBe("string");
      expect(row.label.length).toBeGreaterThan(0);
    }
  });
});
