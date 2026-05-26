import { describe, it, expect } from "vitest";
import {
  valleyfieldDossiers,
  OpportunityDossier,
  weightedScore,
} from "@radar/domain";

describe("valleyfieldDossiers", () => {
  it("exports exactly 3 dossiers", () => {
    expect(valleyfieldDossiers).toHaveLength(3);
  });

  it("each dossier passes OpportunityDossier.parse (schema valid)", () => {
    for (const dossier of valleyfieldDossiers) {
      expect(() => OpportunityDossier.parse(dossier)).not.toThrow();
    }
  });

  it("each dossier scoreGlobal equals weightedScore(scores) within ±0.001", () => {
    for (const dossier of valleyfieldDossiers) {
      const computed = weightedScore(dossier.scores);
      expect(Math.abs(dossier.scoreGlobal - computed)).toBeLessThanOrEqual(0.001);
    }
  });

  it("every evidence item with verification='fait' has a url", () => {
    for (const dossier of valleyfieldDossiers) {
      for (const item of dossier.evidence) {
        if (item.verification === "fait") {
          expect(item.url).toBeDefined();
          expect(typeof item.url).toBe("string");
          expect((item.url as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("all 3 dossiers have distinct ids", () => {
    const ids = valleyfieldDossiers.map((d) => d.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("each dossier has at least one evidence item per phase in [signal, ancrage, contraintes, marche, contexte, scoring]", () => {
    const expectedPhases = ["signal", "ancrage", "contraintes", "marche", "contexte", "scoring"];
    for (const dossier of valleyfieldDossiers) {
      const phases = new Set(dossier.evidence.map((e) => e.phase));
      for (const phase of expectedPhases) {
        expect(phases.has(phase as never), `dossier ${dossier.id} missing phase ${phase}`).toBe(true);
      }
    }
  });
});
