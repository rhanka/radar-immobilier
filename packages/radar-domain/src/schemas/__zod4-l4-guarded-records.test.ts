import { describe, expect, it } from "vitest";
import { OpportunityScore } from "./score.js";
import { CityProfile } from "./ontology/city-profile.js";

function validAxis(overrides = {}) {
  return {
    level: 4,
    availability: "available",
    confidence: "high",
    evidenceRefs: [],
    rationale: "test",
    gridVersion: "v1",
    ...overrides,
  };
}

function scoreDoc(axes: unknown) {
  return {
    axes,
    weightsVersion: "v1",
    partial: true,
    tooThin: false,
    score: null,
    availableWeightSum: 0,
    recommendationCap: "surveiller",
  };
}

const CITY_BASE = {
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

/**
 * L4 characterization for the guarded enum-partial record and the
 * guarded string-value record. Rejects foreign and special keys even
 * when their value alone would validate.
 */
describe("l4 guarded records", () => {
  it("accepts empty and partial axis maps", () => {
    expect(OpportunityScore.safeParse(scoreDoc({}))).toMatchObject({ success: true });
    expect(
      OpportunityScore.safeParse(scoreDoc({ potentiel: validAxis() })).success,
    ).toBe(true);
  });

  it("rejects foreign ordinary and special axis keys", () => {
    expect(OpportunityScore.safeParse(scoreDoc({ inconnu: validAxis() })).success).toBe(false);
    const protoRaw = JSON.parse('{"__proto__": "x"}') as Record<string, unknown>;
    void protoRaw;
    const withProto = JSON.parse(
      `{"potentiel":${JSON.stringify(validAxis())},"__proto__":${JSON.stringify(validAxis())}}`,
    );
    expect(OpportunityScore.safeParse(scoreDoc(withProto)).success).toBe(false);
  });

  it("rejects invalid values under a valid axis key", () => {
    const bad = { potentiel: validAxis({ level: "high" }) };
    expect(OpportunityScore.safeParse(scoreDoc(bad)).success).toBe(false);
  });

  it("accepts a valid prefixToKind string value then strips __proto__", () => {
    const raw = JSON.parse('{"H":"H","__proto__":"H"}') as Record<string, string>;
    const parsed = CityProfile.safeParse({ ...CITY_BASE, zoningRegime: {
      codeScheme: { regex: "^[A-Z]+$", prefixToKind: raw },
      densityUnit: "log-ha",
      gridFormat: "pdf-table",
    } });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-string prefixToKind value including under __proto__", () => {
    const raw = JSON.parse('{"H":"H","__proto__":42}');
    const parsed = CityProfile.safeParse({ ...CITY_BASE, zoningRegime: {
      codeScheme: { regex: "^[A-Z]+$", prefixToKind: raw },
      densityUnit: "log-ha",
      gridFormat: "pdf-table",
    } });
    expect(parsed.success).toBe(false);
  });
});
