import { describe, expect, it } from "vitest";
import {
  countsByStatus,
  demoJobs,
  filterJobsByMode,
} from "./jobs-data.js";

describe("demoJobs", () => {
  it("has at least 8 entries", () => {
    expect(demoJobs.length).toBeGreaterThanOrEqual(8);
  });

  it("includes at least one running job", () => {
    expect(demoJobs.some((j) => j.status === "running")).toBe(true);
  });

  it("includes at least one failed job", () => {
    expect(demoJobs.some((j) => j.status === "failed")).toBe(true);
  });

  it("all jobs are mode:real (no invented/simulated data)", () => {
    expect(demoJobs.every((j) => j.mode === "real")).toBe(true);
  });

  it("all jobs have valid status", () => {
    const validStatuses = new Set(["queued", "running", "done", "failed"]);
    for (const job of demoJobs) {
      expect(validStatuses.has(job.status)).toBe(true);
    }
  });

  it("all jobs have valid type", () => {
    const validTypes = new Set(["ingestion", "scan", "scoring", "backfill"]);
    for (const job of demoJobs) {
      expect(validTypes.has(job.type)).toBe(true);
    }
  });

  it("all jobs have ISO startedAt strings", () => {
    for (const job of demoJobs) {
      expect(() => new Date(job.startedAt).toISOString()).not.toThrow();
    }
  });
});

describe("countsByStatus", () => {
  it("has all 4 status keys", () => {
    const counts = countsByStatus();
    expect(counts).toHaveProperty("queued");
    expect(counts).toHaveProperty("running");
    expect(counts).toHaveProperty("done");
    expect(counts).toHaveProperty("failed");
  });

  it("values sum to demoJobs.length when called with no argument", () => {
    const counts = countsByStatus();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(demoJobs.length);
  });

  it("works with a custom jobs array", () => {
    const subset = demoJobs.slice(0, 3);
    const counts = countsByStatus(subset);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });

  it("returns 0 for statuses not present in input", () => {
    const counts = countsByStatus([]);
    expect(counts.queued).toBe(0);
    expect(counts.running).toBe(0);
    expect(counts.done).toBe(0);
    expect(counts.failed).toBe(0);
  });
});

describe("filterJobsByMode", () => {
  it('mode="real" drops no rows (all jobs are already real)', () => {
    const real = filterJobsByMode(demoJobs, "real");
    expect(real.every((j) => j.mode !== "simulation")).toBe(true);
    expect(real).toHaveLength(demoJobs.length);
  });

  it('mode="simulation" keeps all rows', () => {
    const all = filterJobsByMode(demoJobs, "simulation");
    expect(all).toHaveLength(demoJobs.length);
  });

  it('mode="real" keeps only real-mode jobs', () => {
    const real = filterJobsByMode(demoJobs, "real");
    const expectedCount = demoJobs.filter((j) => j.mode === "real").length;
    expect(real.length).toBe(expectedCount);
  });
});
