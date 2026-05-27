import { describe, it, expect } from "vitest";
import {
  EvidenceItem,
  OpportunityDossier,
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

  it("rejects an invalid value", () => {
    expect(Verification.safeParse("foo").success).toBe(false);
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

const minimalAxes = {
  potentiel: { level: 4, availability: "available", confidence: "high", evidenceRefs: [], rationale: "test", gridVersion: "v1" },
  risque:    { level: 3, availability: "available", confidence: "low",  evidenceRefs: [], rationale: "test", gridVersion: "v1" },
  timing:    { level: 3, availability: "available", confidence: "medium", evidenceRefs: [], rationale: "test", gridVersion: "v1" },
  faisabilite: { level: 2, availability: "available", confidence: "low", evidenceRefs: [], rationale: "test", gridVersion: "v1" },
  marche:    { level: null, availability: "non-disponible", confidence: "low", evidenceRefs: [], rationale: "test", gridVersion: "v1" },
};

describe("OpportunityDossier ÉV1 enrichment", () => {
  const minimal = {
    id: "d1", title: "t", bylaw: "150-49", zone: "H-609-4", address: "a",
    signalId: "sig-1",
    lots: [{ noLot: "1" }],
    evidence: [], scores: { potentiel: 4, risque: 3, timing: 3, faisabilite: 2, marche: 3 },
    scoreGlobal: 3.15, recommendation: "Surveiller",
    axes: minimalAxes,
  };
  it("requires signalId, applies lot + mode defaults", () => {
    const r = OpportunityDossier.safeParse(minimal);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.mode).toBe("real");
      const lot0 = r.data.lots[0]!;
      expect(lot0.confirmed).toBe(false);
      expect(lot0.zonePolygonSource).toBe("hypothese-street-name");
    }
  });
  it("rejects a dossier missing signalId", () => {
    const { signalId: _signalId, ...noSig } = minimal;
    expect(OpportunityDossier.safeParse(noSig).success).toBe(false);
  });
  it("rejects an unknown zonePolygonSource", () => {
    const bad = { ...minimal, lots: [{ noLot: "1", zonePolygonSource: "satellite" }] };
    expect(OpportunityDossier.safeParse(bad).success).toBe(false);
  });
});

describe("OpportunityDossier axes envelope (Task 10)", () => {
  const base = {
    id: "d1", title: "t", bylaw: "150-49", zone: "H-609-4", address: "a",
    signalId: "sig-1",
    lots: [{ noLot: "1" }],
    evidence: [], scores: { potentiel: 4, risque: 3, timing: 3, faisabilite: 2, marche: 3 },
    scoreGlobal: 3.15, recommendation: "Surveiller",
  };

  it("parses a dossier with a valid axes map", () => {
    const r = OpportunityDossier.safeParse({ ...base, axes: minimalAxes });
    expect(r.success).toBe(true);
    if (r.success) {
      // z.record infers Partial<Record<...>> — use non-null assertions (axes populated in full)
      expect(r.data.axes!.marche!.availability).toBe("non-disponible");
      expect(r.data.axes!.marche!.level).toBeNull();
      expect(r.data.axes!.potentiel!.level).toBe(4);
    }
  });

  it("rejects an axes map where available=true but level=null (invariant violation)", () => {
    const bad = {
      ...base,
      axes: {
        ...minimalAxes,
        potentiel: { level: null, availability: "available", confidence: "high", evidenceRefs: [], rationale: "bad", gridVersion: "v1" },
      },
    };
    const r = OpportunityDossier.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors.some((e) => e.message.includes("invariant"))).toBe(true);
    }
  });
});
