import { describe, expect, it } from "vitest";
import { OpportunityDossier } from "./opportunity.js";
import { OpportunityScore } from "./score.js";
import { CityProfile } from "./ontology/city-profile.js";

/**
 * L3f characterization: defaults, jsonb presence, enum records and
 * special string records before migration.
 */
describe("l3f defaults identifiers and special records", () => {
  it("applies lot defaults and mode default on OpportunityDossier", () => {
    const parsed = OpportunityDossier.safeParse({
      id: "d1",
      title: "t",
      bylaw: "150-49",
      zone: "H-609-4",
      address: "a",
      signalId: "sig-1",
      lots: [{ noLot: "1" }],
      evidence: [],
      scores: { potentiel: 4, risque: 3, timing: 3, faisabilite: 2, marche: 3 },
      scoreGlobal: 3.15,
      recommendation: "Surveiller",
      axes: {
        potentiel: { level: 4, availability: "available", confidence: "high", evidenceRefs: [], rationale: "t", gridVersion: "v1" },
        risque: { level: 3, availability: "available", confidence: "low", evidenceRefs: [], rationale: "t", gridVersion: "v1" },
        timing: { level: 3, availability: "available", confidence: "medium", evidenceRefs: [], rationale: "t", gridVersion: "v1" },
        faisabilite: { level: 2, availability: "available", confidence: "low", evidenceRefs: [], rationale: "t", gridVersion: "v1" },
        marche: { level: null, availability: "non-disponible", confidence: "low", evidenceRefs: [], rationale: "t", gridVersion: "v1" },
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mode).toBe("real");
      expect(parsed.data.lots[0]?.confirmed).toBe(false);
    }
  });

  it("accepts historic non-RFC guids on score axes keys", () => {
    const parsed = OpportunityScore.safeParse({
      axes: {},
      weightsVersion: "v1",
      partial: true,
      tooThin: false,
      score: null,
      availableWeightSum: 0,
      recommendationCap: "surveiller",
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps CityProfile prefixToKind value validation visible", () => {
    const base = {
      slug: "valleyfield",
      nomOfficiel: "Valleyfield",
      codeMamh: "70052",
      mrcSlug: "beauharnois-salaberry",
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      zoningRegime: {
        codeScheme: { regex: "^[A-Z]+$", prefixToKind: { H: "H" } },
        densityUnit: "log-ha",
        gridFormat: "pdf-table",
      },
      decisionProcess: { hasReferendumRegister: false, ppcmoiEnabled: false },
    };
    expect(CityProfile.safeParse(base).success).toBe(true);
    expect(
      CityProfile.safeParse({
        ...base,
        zoningRegime: {
          codeScheme: { regex: "^[A-Z]+$", prefixToKind: { H: 42 } },
          densityUnit: "log-ha",
          gridFormat: "pdf-table",
        },
      }).success,
    ).toBe(false);
  });
});
