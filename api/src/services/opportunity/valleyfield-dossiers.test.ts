import { describe, it, expect } from "vitest";
import { OpportunityDossier, weightedScore } from "@radar/domain";
import { valleyfieldDossiers } from "./valleyfield-dossiers.js";

describe("valleyfield-dossiers", () => {
  it("exports exactly 3 dossiers", () => {
    expect(valleyfieldDossiers).toHaveLength(3);
  });

  it("each dossier parses as a valid OpportunityDossier", () => {
    for (const d of valleyfieldDossiers) {
      expect(() => OpportunityDossier.parse(d)).not.toThrow();
    }
  });

  it("each dossier scoreGlobal equals weightedScore(scores) within 0.001", () => {
    for (const d of valleyfieldDossiers) {
      const expected = weightedScore(d.scores);
      expect(d.scoreGlobal).toBeCloseTo(expected, 3);
    }
  });

  it("each dossier has ≥1 evidence item for phase 'signal'", () => {
    for (const d of valleyfieldDossiers) {
      const signalItems = d.evidence.filter((e) => e.phase === "signal");
      expect(signalItems.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("each dossier has ≥1 evidence item for phase 'contraintes'", () => {
    for (const d of valleyfieldDossiers) {
      const contraintesItems = d.evidence.filter(
        (e) => e.phase === "contraintes"
      );
      expect(contraintesItems.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("no evidence item with verification 'fait' lacks a url", () => {
    for (const d of valleyfieldDossiers) {
      const invalidItems = d.evidence.filter(
        (e) => e.verification === "fait" && !e.url
      );
      expect(invalidItems).toHaveLength(0);
    }
  });

  it("each dossier has ≥2 lots", () => {
    for (const d of valleyfieldDossiers) {
      expect(d.lots.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("the 3 bylaw identifiers are the expected ones", () => {
    const bylaws = valleyfieldDossiers.map((d) => d.bylaw);
    expect(bylaws).toContain("150-49");
    expect(bylaws).toContain("150-51");
    expect(bylaws).toContain("150-49-1");
  });
});
