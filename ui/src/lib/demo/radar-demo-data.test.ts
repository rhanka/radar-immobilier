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
      activeSignals: 4,
      highPotentialSignals: 2,
      topScore: 82,
      nextMilestone: "Conseil municipal - 2026-06-17",
    });
  });

  it("finds a signal by id without mutating the signal list", () => {
    const before = demoSignals.map((signal) => signal.id);

    const signal = getSignalById(demoSignals, "sig-ppcmoi-2026-04");

    expect(signal?.title).toBe("PPCMOI - rue Victoria");
    expect(demoSignals.map((item) => item.id)).toEqual(before);
  });
});
