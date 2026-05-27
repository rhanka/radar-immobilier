import { describe, expect, it } from "vitest";
import { sourceEvaluations } from "../source-review/source-evaluation-data";
import {
  RECOMMENDATION_LABELS_FR,
  VISION_ALIGNMENT_LABELS_FR,
  defaultSelection,
  groupByRecommendation,
  summarize,
} from "./onboarding-data";

describe("groupByRecommendation", () => {
  it("covers all catalogue sources", () => {
    const groups = groupByRecommendation();
    const total = groups.reduce((sum, g) => sum + g.sources.length, 0);
    expect(total).toBe(sourceEvaluations.length);
  });

  it("starts with build-now group", () => {
    const groups = groupByRecommendation();
    expect(groups[0].recommendation).toBe("build-now");
  });

  it("orders build-now → qualify-access-now → build-later then others", () => {
    const groups = groupByRecommendation();
    const recs = groups.map((g) => g.recommendation);
    const buildNowIdx = recs.indexOf("build-now");
    const qualifyIdx = recs.indexOf("qualify-access-now");
    const buildLaterIdx = recs.indexOf("build-later");
    expect(buildNowIdx).toBeLessThan(qualifyIdx);
    expect(qualifyIdx).toBeLessThan(buildLaterIdx);
  });

  it("each group has a non-empty French label", () => {
    const groups = groupByRecommendation();
    for (const g of groups) {
      expect(g.label.length).toBeGreaterThan(0);
    }
  });

  it("accepts a custom sources array", () => {
    const subset = sourceEvaluations.filter((s) => s.recommendation === "build-now");
    const groups = groupByRecommendation(subset);
    expect(groups).toHaveLength(1);
    expect(groups[0].recommendation).toBe("build-now");
    expect(groups[0].sources).toHaveLength(subset.length);
  });
});

describe("defaultSelection", () => {
  it("is non-empty", () => {
    expect(defaultSelection().length).toBeGreaterThan(0);
  });

  it("every id maps to a build-now source", () => {
    const ids = defaultSelection();
    const byId = new Map(sourceEvaluations.map((s) => [s.id, s]));
    for (const id of ids) {
      const src = byId.get(id);
      expect(src).toBeDefined();
      expect(src!.recommendation).toBe("build-now");
    }
  });

  it("covers exactly all build-now sources", () => {
    const buildNow = sourceEvaluations.filter((s) => s.recommendation === "build-now");
    expect(defaultSelection()).toHaveLength(buildNow.length);
  });
});

describe("summarize", () => {
  it("total matches selection length", () => {
    const ids = defaultSelection();
    const summary = summarize(ids);
    expect(summary.total).toBe(ids.length);
  });

  it("byTier values sum to total", () => {
    const ids = defaultSelection();
    const summary = summarize(ids);
    const tierSum = Object.values(summary.byTier).reduce((a, b) => a + b, 0);
    expect(tierSum).toBe(summary.total);
  });

  it("handles empty selection", () => {
    const summary = summarize([]);
    expect(summary.total).toBe(0);
    expect(Object.keys(summary.byTier)).toHaveLength(0);
  });

  it("ignores ids not found in sources", () => {
    const summary = summarize(["nonexistent-id"]);
    expect(summary.total).toBe(0);
  });

  it("accepts custom sources array", () => {
    const subset = sourceEvaluations.slice(0, 3);
    const ids = subset.map((s) => s.id);
    const summary = summarize(ids, subset);
    expect(summary.total).toBe(3);
  });
});

describe("RECOMMENDATION_LABELS_FR", () => {
  it("has an entry for every RecommendationKind", () => {
    const kinds = [
      "build-now",
      "build-later",
      "qualify-access-now",
      "manual-check",
      "drop-phase-1",
    ] as const;
    for (const kind of kinds) {
      expect(RECOMMENDATION_LABELS_FR[kind]).toBeDefined();
      expect(RECOMMENDATION_LABELS_FR[kind].length).toBeGreaterThan(0);
    }
  });
});

describe("VISION_ALIGNMENT_LABELS_FR", () => {
  it("has an entry for every VisionAlignment", () => {
    const values = [
      "regulatory-signal",
      "parcel-anchor",
      "constraint-filter",
      "market-validation",
      "strategic-context",
      "history-learning",
      "false-positive-control",
    ] as const;
    for (const v of values) {
      expect(VISION_ALIGNMENT_LABELS_FR[v]).toBeDefined();
      expect(VISION_ALIGNMENT_LABELS_FR[v].length).toBeGreaterThan(0);
    }
  });
});
