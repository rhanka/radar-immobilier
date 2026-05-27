import { describe, it, expect } from "vitest";
import {
  EvidenceItem,
  PROCESS_WEIGHTS,
  Verification,
  weightedScore,
} from "./opportunity.js";

describe("EvidenceItem", () => {
  it("accepts a fully-traced item", () => {
    const result = EvidenceItem.safeParse({
      phase: "signal",
      sourceId: "source-valleyfield-1",
      label: "Règlement de zonage modifié",
      url: "https://example.com/regl-2024.pdf",
      date: "2024-05",
      obtentionMode: "download",
      confidence: "high",
      verification: "fait",
      value: "zone commerciale mixte",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a verification='fait' item that has no url", () => {
    const result = EvidenceItem.safeParse({
      phase: "ancrage",
      sourceId: "source-valleyfield-2",
      label: "Valeur foncière",
      date: "2024-01",
      obtentionMode: "manual",
      confidence: "medium",
      verification: "fait",
      // no url — should fail
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.errors.some((e) =>
          e.message.includes("verified") || e.message.includes("url")
        )
      ).toBe(true);
    }
  });

  it("accepts a verification='hypothese' item without url", () => {
    const result = EvidenceItem.safeParse({
      phase: "marche",
      sourceId: "source-valleyfield-3",
      label: "Estimation valeur projetée",
      date: "2024-03",
      obtentionMode: "manual",
      confidence: "low",
      verification: "hypothese",
    });
    expect(result.success).toBe(true);
  });
});

describe("PROCESS_WEIGHTS", () => {
  it("has the correct weight values", () => {
    expect(PROCESS_WEIGHTS).toEqual({
      potentiel: 0.30,
      risque: 0.20,
      timing: 0.20,
      faisabilite: 0.15,
      marche: 0.15,
    });
  });

  it("weights sum to 1", () => {
    const total = Object.values(PROCESS_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });
});

describe("Verification simulé", () => {
  it("accepts the 4 values incl. simulé", () => {
    for (const v of ["fait", "hypothese", "non-disponible", "simulé"])
      expect(Verification.safeParse(v).success).toBe(true);
  });
});

describe("weightedScore", () => {
  it("computes the correct weighted score ≈ 4.05", () => {
    const score = weightedScore({
      potentiel: 5,
      risque: 4,
      timing: 5,
      faisabilite: 3,
      marche: 2,
    });
    // 5*0.30 + 4*0.20 + 5*0.20 + 3*0.15 + 2*0.15
    // = 1.50 + 0.80 + 1.00 + 0.45 + 0.30 = 4.05
    expect(score).toBeCloseTo(4.05, 10);
  });
});
