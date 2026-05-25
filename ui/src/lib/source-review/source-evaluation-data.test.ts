import { describe, expect, it } from "vitest";
import {
  criteriaDefinitions,
  getAccessPrioritySources,
  getQuadrant,
  getRecommendationSummary,
  sourceEvaluations,
} from "./source-evaluation-data";

describe("source evaluation data", () => {
  it("covers the 34 BR05 source spikes", () => {
    expect(sourceEvaluations).toHaveLength(34);
    expect(new Set(sourceEvaluations.map((source) => source.id)).size).toBe(34);
  });

  it("defines explicit scoring criteria for recall, precision and access complexity", () => {
    const criterionIds = criteriaDefinitions.map((criterion) => criterion.id);

    expect(criterionIds).toEqual(
      expect.arrayContaining([
        "signal-faible",
        "precision",
        "rappel",
        "faux-positif",
        "friction-acces",
        "risque-legal",
        "complexite-cout",
      ]),
    );
  });

  it("places early municipal weak signals in the build-now quadrant", () => {
    const avis = sourceEvaluations.find(
      (source) => source.id === "avis-publics-valleyfield",
    );

    expect(avis).toBeDefined();
    expect(getQuadrant(avis!)).toBe("high-value-low-complexity");
    expect(avis?.visionAlignment).toContain("regulatory-signal");
  });

  it("treats paid/high-cost and qualify-access sources as access priorities", () => {
    const priorityIds = getAccessPrioritySources(sourceEvaluations).map(
      (source) => source.id,
    );

    expect(priorityIds).toEqual(
      expect.arrayContaining([
        "jlr",
        "registre-foncier-qc",
        "centris-mls",
        "cadastre-infolot",
        "videos-youtube-conseil-valleyfield",
      ]),
    );
  });

  it("includes YouTube in access-priority recommendations", () => {
    expect(
      getAccessPrioritySources(sourceEvaluations).map((source) => source.id),
    ).toContain("videos-youtube-conseil-valleyfield");
  });

  it("keeps the recommendation triad complete for every source", () => {
    for (const source of sourceEvaluations) {
      expect(source.done.length, `${source.id} done`).toBeGreaterThan(0);
      expect(source.next.length, `${source.id} next`).toBeGreaterThan(0);
      expect(source.clientExpected.length, `${source.id} expected`).toBeGreaterThan(
        0,
      );
    }
  });

  it("summarizes recommendations for the review panel", () => {
    expect(getRecommendationSummary(sourceEvaluations)).toMatchObject({
      buildNow: 7,
      buildLater: 18,
      qualifyAccessNow: 5,
      manualCheck: 1,
      dropPhase1: 3,
    });
  });
});
