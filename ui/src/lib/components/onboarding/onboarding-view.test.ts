import { describe, it, expect } from "vitest";
import {
  defaultSelection,
  groupByRecommendation,
  summarize,
  RETRO_WINDOW_MONTHS_DEFAULT,
} from "$lib/onboarding/onboarding-data.js";

// Illustrative estimate helper — mirrors the formula used in OnboardingView.
const SIGNAL_RATE_PER_SOURCE_PER_YEAR = 8;

function illustrativeEstimate(selectedCount: number, windowMonths: number): number {
  return selectedCount * (windowMonths / 12) * SIGNAL_RATE_PER_SOURCE_PER_YEAR;
}

describe("OnboardingView — data-layer contracts", () => {
  describe("defaultSelection", () => {
    it("is a subset of build-now sources", () => {
      const buildNowIds = new Set(
        groupByRecommendation()
          .filter((g) => g.recommendation === "build-now")
          .flatMap((g) => g.sources.map((s) => s.id)),
      );
      for (const id of defaultSelection()) {
        expect(buildNowIds.has(id)).toBe(true);
      }
    });

    it("is non-empty", () => {
      expect(defaultSelection().length).toBeGreaterThan(0);
    });
  });

  describe("summarize", () => {
    it("total equals defaultSelection length", () => {
      const ids = defaultSelection();
      expect(summarize(ids).total).toBe(ids.length);
    });

    it("byRecommendation values sum to total", () => {
      const ids = defaultSelection();
      const { total, byRecommendation } = summarize(ids);
      const recSum = Object.values(byRecommendation).reduce((a, b) => a + b, 0);
      expect(recSum).toBe(total);
    });

    it("empty selection yields total 0 and empty byRecommendation", () => {
      const { total, byRecommendation } = summarize([]);
      expect(total).toBe(0);
      expect(Object.keys(byRecommendation)).toHaveLength(0);
    });
  });

  describe("groupByRecommendation", () => {
    it("first group is build-now", () => {
      const groups = groupByRecommendation();
      expect(groups[0].recommendation).toBe("build-now");
    });

    it("all groups have a non-empty French label", () => {
      for (const g of groupByRecommendation()) {
        expect(g.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("RETRO_WINDOW_MONTHS_DEFAULT", () => {
    it("is 24", () => {
      expect(RETRO_WINDOW_MONTHS_DEFAULT).toBe(24);
    });
  });

  describe("illustrativeEstimate helper", () => {
    it("returns a non-negative number for any valid input", () => {
      expect(illustrativeEstimate(0, 24)).toBeGreaterThanOrEqual(0);
      expect(illustrativeEstimate(5, 12)).toBeGreaterThanOrEqual(0);
      expect(illustrativeEstimate(10, 36)).toBeGreaterThanOrEqual(0);
    });

    it("scales linearly with selected count", () => {
      const base = illustrativeEstimate(1, 24);
      expect(illustrativeEstimate(3, 24)).toBe(base * 3);
    });

    it("scales linearly with window months", () => {
      const base = illustrativeEstimate(5, 12);
      expect(illustrativeEstimate(5, 24)).toBe(base * 2);
    });

    it("returns 0 for empty selection", () => {
      expect(illustrativeEstimate(0, 24)).toBe(0);
    });

    it("default window yields positive estimate for non-empty default selection", () => {
      const count = defaultSelection().length;
      expect(illustrativeEstimate(count, RETRO_WINDOW_MONTHS_DEFAULT)).toBeGreaterThan(0);
    });
  });
});
