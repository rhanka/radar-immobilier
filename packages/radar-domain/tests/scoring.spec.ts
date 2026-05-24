import { describe, it, expect } from "vitest";
import {
  SCORING_CRITERIA,
  TOTAL_WEIGHT,
  aggregateRadarScore,
} from "../src/scoring.js";

describe("scoring model", () => {
  it("weights sum to 100", () => {
    expect(TOTAL_WEIGHT).toBe(100);
  });

  it("has the five PROCESS §3 criteria", () => {
    expect(SCORING_CRITERIA.map((c) => c.key)).toEqual([
      "regulatory_potential",
      "constraint_risk",
      "timing",
      "land_feasibility",
      "market_value",
    ]);
  });

  it("returns 0 for no scores", () => {
    expect(aggregateRadarScore({})).toBe(0);
  });

  it("returns 100 for all criteria maxed", () => {
    expect(
      aggregateRadarScore({
        regulatory_potential: 5,
        constraint_risk: 5,
        timing: 5,
        land_feasibility: 5,
        market_value: 5,
      }),
    ).toBe(100);
  });

  it("weights regulatory_potential at 30%", () => {
    expect(aggregateRadarScore({ regulatory_potential: 5 })).toBe(30);
  });

  it("clamps out-of-range raw scores", () => {
    expect(aggregateRadarScore({ regulatory_potential: 99 })).toBe(30);
  });
});
