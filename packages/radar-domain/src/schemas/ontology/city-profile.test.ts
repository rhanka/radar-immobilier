import { describe, expect, it } from "vitest";
import { CityProfile, SourceBinding } from "./city-profile.js";

/**
 * CityProfile + SourceBinding tests (SPEC_ONTOLOGY §5).
 *
 * REAL-DATA NOTE: code MAMH "70052" and the city name are REAL
 * (Salaberry-de-Valleyfield, the pilot). The bbox, zoning regex, selectors and
 * adapter ids are ILLUSTRATIVE placeholders for schema exercise.
 */

const binding = {
  sourceId: "valleyfield-avis-craft",
  kind: "avis-public" as const,
  channel: { engine: "craft" as const },
  adapter: "avis-publics-valleyfield",
};

describe("SourceBinding", () => {
  it("parses with channel/auth/cadence/tier defaults", () => {
    const b = SourceBinding.parse(binding);
    expect(b.auth).toBe("none");
    expect(b.cadence).toBe("weekly");
    expect(b.tier).toBe("B");
    expect(b.channel.url).toBeNull();
  });
  it("rejects an unknown engine", () => {
    expect(() =>
      SourceBinding.parse({ ...binding, channel: { engine: "drupal" } }),
    ).toThrow();
  });
});

describe("CityProfile", () => {
  it("parses the pilot city with a typed SourceBinding[]", () => {
    const c = CityProfile.parse({
      slug: "salaberry-de-valleyfield",
      nomOfficiel: "Salaberry-de-Valleyfield", // REAL
      codeMamh: "70052", // REAL
      mrcSlug: "beauharnois-salaberry",
      bbox: { minLon: -74.2, minLat: 45.2, maxLon: -74.0, maxLat: 45.3 },
      zoningRegime: {
        codeScheme: { regex: "([A-Z]{1,4})[\\s\\-.]?(\\d+)", prefixToKind: { H: "H", C: "C" } },
        densityUnit: "log-ha",
        gridFormat: "pdf-table",
      },
      decisionProcess: { hasReferendumRegister: true, ppcmoiEnabled: true },
      sources: [binding],
    });
    expect(c.dguidStatcan).toBeNull();
    expect(c.sources).toHaveLength(1);
    expect(c.decisionProcess.cptaqVariants).toEqual([]);
  });
  it("rejects a profile without a code scheme regex", () => {
    expect(() =>
      CityProfile.parse({
        slug: "x",
        nomOfficiel: "X",
        codeMamh: "00000",
        mrcSlug: "y",
        bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
        zoningRegime: { codeScheme: { regex: "", prefixToKind: {} }, densityUnit: "cos", gridFormat: "html" },
        decisionProcess: { hasReferendumRegister: false, ppcmoiEnabled: false },
      }),
    ).toThrow();
  });
});
