import { describe, expect, it } from "vitest";
import {
  demoOpportunity,
  demoSignals,
  getDashboardMetrics,
  getSignalById,
} from "./radar-demo-data";

describe("radar demo data", () => {
  it("computes dashboard metrics from demo signals", () => {
    expect(getDashboardMetrics(demoSignals, demoOpportunity)).toEqual({
      activeSignals: 5,
      highPotentialSignals: 2,
      topScore: 90,
      nextMilestone: "Adoption du règlement 150-49 (en attente)",
    });
  });

  it("finds a signal by id without mutating the signal list", () => {
    const before = demoSignals.map((signal) => signal.id);

    const signal = getSignalById(demoSignals, "sig-zoning-150-49");

    expect(signal?.title).toBe("Règlement 150-49 — densité conditionnelle des boisés");
    expect(demoSignals.map((item) => item.id)).toEqual(before);
  });

  it("carries an official source link and a fact/hypothesis tag on every signal", () => {
    for (const signal of demoSignals) {
      expect(signal.sourceUrl).toMatch(/^https?:\/\//);
      expect(["fait", "hypothese"]).toContain(signal.verification);
    }
  });
});
